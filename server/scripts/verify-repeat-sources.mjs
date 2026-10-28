/**
 * 重点攻克页「来源列表」回归（真 Chrome + CDP）
 *
 * 这一页的 bug 只可能出现在客户端：接口给的数据对不对，和“用户看到一行一条、点了能不能跳过去”
 * 是两件事。所以断言全部落在 DOM 上。
 *
 * 覆盖：
 *   1 卡片渲染
 *   2 第一张卡列出来源（≥2 条）
 *   3 每条来源独占一行（不换行挤成一行、也不被省略成 +N）
 *   4 来源数 = 接口返回的 docs 数（“列出所有来源”）
 *   5 每条来源链接都带 ?mark= 定位参数
 *   6 点击后确实跳到 /read/<textId>?mark=<markId>
 *   7 落点正确：该词所在段落被滚进视口，且生词弹窗已打开
 *
 * 用法：node server/scripts/verify-repeat-sources.mjs
 * 需要服务在跑（npm run dev），临时 profile 需要 CODEBUDDY_SAFE_DELETE_ENABLED=0 才删得掉。
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { launchChrome, resolveBase, sleep, waitFor } from './lib/cdp.mjs'

const env = readFileSync('.env', 'utf8').split(/\r?\n/).reduce((a, l) => {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) a[m[1]] = m[2].replace(/^["']|["']$/g, '')
  return a
}, {})
const TOKEN = createHash('sha256').update(env.SITE_PASSWORD || '').digest('hex')

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok })
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

const BASE = await resolveBase()
const api = await (await fetch(`${BASE}/api/wordbooks/repeat?min=2&limit=300`, {
  headers: { Cookie: `auth_token=${TOKEN}` },
})).json()

const top = api.items?.[0]
if (!top) {
  console.error('接口没有返回任何词，先确认服务与数据')
  process.exit(1)
}
console.log(`接口：${api.items.length} 个词，第一张卡「${top.term}」有 ${top.docs.length} 篇来源`)

let page = null
let failed = 0
try {
  page = await launchChrome({ profile: 'server/data/.tmp-e2e-src', base: BASE, token: TOKEN })
  await page.goto(`${BASE}/wordbooks/repeat`)
  await waitFor(async () => (await page.evalInPage('document.querySelectorAll(".rp-card").length')) > 0,
    { timeout: 30000, interval: 400, label: '卡片渲染' })

  const shape = await page.evalInPage(`(() => {
    const card = document.querySelector('.rp-card')
    const rows = Array.from(card.querySelectorAll('.rp-src-item'))
    const rects = rows.map(r => r.getBoundingClientRect())
    return {
      cards: document.querySelectorAll('.rp-card').length,
      term: card.querySelector('.rp-term')?.textContent.trim(),
      rows: rows.length,
      titles: rows.map(r => r.querySelector('.rp-src-title')?.textContent.trim()),
      hrefs: rows.map(r => r.querySelector('a')?.getAttribute('href')),
      // 一行放一个：每行左端对齐，纵向依次下移
      onePerLine: rects.every((r, i) => i === 0
        || (r.top > rects[i - 1].top + 5 && Math.abs(r.left - rects[0].left) < 2)),
      truncated: !!card.querySelector('.rp-doc-more'),
    }
  })()`)

  check('1 卡片渲染', shape.cards > 0, `${shape.cards} 张`)
  check('2 第一张卡列出来源', shape.rows >= 2, `「${shape.term}」${shape.rows} 条`)
  check('3 每条来源独占一行', shape.onePerLine, shape.rows ? shape.titles[0] : '')
  check('4 列全所有来源（无 +N 省略）', shape.rows === top.docs.length && !shape.truncated,
    `页面 ${shape.rows} / 接口 ${top.docs.length}`)
  check('5 链接带定位参数', shape.hrefs.every(h => /^\/read\/[^?]+\?mark=/.test(h || '')),
    shape.hrefs[0] || '(无)')

  // ---- 点击第一条来源，验证真的跳到了词所在位置 ----
  await page.evalInPage('document.querySelector(".rp-src-row").click()')
  let landed = false
  try {
    await waitFor(async () => (await page.evalInPage('location.pathname.startsWith("/read/")')), 
      { timeout: 15000, interval: 200, label: '跳转阅读页' })
    landed = true
  } catch {}
  const target = shape.hrefs[0] || ''
  check('6 跳转到阅读页并保留定位参数', landed && (await page.evalInPage('location.search')).includes('mark='),
    (await page.evalInPage('location.pathname + location.search')) || '')

  // 落点：段落进视口 + 弹窗打开。阅读页首屏要编译 + 解码大图，给足时间。
  let hit = null
  try {
    await waitFor(async () => {
      const r = await page.evalInPage(`(() => {
        const term = ${JSON.stringify(top.term)}
        const popup = document.querySelector('.mark-popup')
        const blocks = Array.from(document.querySelectorAll('.para-block'))
        const inView = blocks.find(b => {
          const rect = b.getBoundingClientRect()
          return rect.top < innerHeight && rect.bottom > 0
            && b.innerText.toLowerCase().includes(term.toLowerCase())
        })
        return { popup: !!popup, popupTerm: popup?.querySelector('.mp-word-text')?.textContent.trim() || '',
                 visibleBlocks: blocks.filter(b => { const r = b.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 }).length,
                 hit: inView ? inView.getAttribute('data-id') : '' }
      })()`)
      hit = r
      return r.popup && !!r.hit
    }, { timeout: 25000, interval: 400, label: '定位落点' })
  } catch {}
  check('7 该词所在段落进入视口且打开释义弹窗', !!hit?.popup && !!hit?.hit,
    hit ? `段落 ${hit.hit}，弹窗词条 ${hit.popupTerm || '(空)'}` : '')
} catch (e) {
  console.error('运行出错：', e.message)
  failed = 1
} finally {
  await page?.close()
}

const bad = results.filter(r => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} 通过`)
if (bad.length) {
  console.log('失败项：' + bad.map(b => b.name).join(' / '))
  process.exit(1)
}
process.exit(failed)
