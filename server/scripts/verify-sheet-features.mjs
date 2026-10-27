/**
 * 图片试卷三件事的端到端回归（真 Chrome）
 *
 *   ① 答案遮挡：页上盖住答案区、点一下临时显形、顶栏一键全显
 *   ② AI 自动切题：调模型切出题目区，确认后写成 kind='q' 的标注
 *   ③ 错题本：跨试卷聚合 kind='wrong'，评分走 SRS
 *
 * 为什么必须用真浏览器：这三件事的价值全在交互上 ——
 * 遮挡是渲染层（不透明、可掀开），切题是「画布上多了几个框」，
 * 错题本是「点卡片、评分、卡片消失」。node 打接口只能证明数据存下来了。
 *
 * 用法：node server/scripts/verify-sheet-features.mjs [sheetId]
 * 依赖：本地 dev 服务 + Chrome/Edge + .env 的 SITE_PASSWORD / DEEPSEEK_API_KEY
 * 说明：会临时改写该试卷的 annotations 与 covers，跑完（含异常）自动复原。
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { launchChrome, resolveBase, sleep, waitFor } from './lib/cdp.mjs'

const env = readFileSync('.env', 'utf8').split(/\r?\n/).reduce((a, l) => {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) a[m[1]] = m[2].replace(/^["']|["']$/g, '')
  return a
}, {})

const BASE = await resolveBase(process.env.BASE_URL)
const TOKEN = createHash('sha256').update(env.SITE_PASSWORD || '').digest('hex')

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok })
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

async function api(pathname, init = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { Cookie: `auth_token=${TOKEN}`, ...(init.headers || {}) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${text.slice(0, 200)}`)
  try { return JSON.parse(text) } catch { return text }
}
const post = (p, body) => api(p, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

let page = null
let sheetId = ''
let origAnnotations = []
let origCovers = []
let dirty = false
// 每次运行都用新 id：sheet_wrong 的 SRS 状态是按标注 id 记的，
// 复用固定 id 会让第二次运行拿到「已评过、还没到期」的旧状态，due 列表直接是空的。
const W_ID = `an_e2e_wrong_${Date.now()}`

const EVAL = {
  covers: 'document.querySelectorAll(".sheet-cover").length',
  peeking: 'document.querySelectorAll(".sheet-cover.peeking").length',
  qBoxes: 'document.querySelectorAll(".sheet-anno.k-q").length',
  wrongCards: 'document.querySelectorAll(".wp-card").length',
}

try {
  // ── 准备：找一份试卷 ──
  const all = await api('/api/text/list?folder=all')
  const sheet = process.argv[2]
    ? all.find((x) => x.id === process.argv[2])
    : all.find((x) => x.contentKind === 'sheet')
  if (!sheet) throw new Error('没找到图片试卷，先用 /sheet 上传一份')
  sheetId = sheet.id

  const row = await api(`/api/text/${sheetId}`)
  const pages = Array.isArray(row.segments) ? row.segments : []
  if (!pages.length) throw new Error('这份试卷没有页面')
  origAnnotations = Array.isArray(row.annotations) ? row.annotations : []
  origCovers = Array.isArray(pages[0].covers) ? pages[0].covers : []

  // 写入两条固定的测试数据：一条错题（给错题本）+ 两块遮挡（给遮挡）
  const seedAnnos = [
    ...origAnnotations.filter(a => a.id !== W_ID),
    { id: W_ID, pageId: pages[0].id, kind: 'wrong', bbox: { x: 0.1, y: 0.2, w: 0.5, h: 0.1 }, note: 'E2E 测试错题', createdAt: new Date().toISOString() },
  ]
  await post(`/api/sheet/${sheetId}/annotations`, { annotations: seedAnnos })
  await post(`/api/sheet/${sheetId}/covers`, {
    pageId: pages[0].id,
    covers: [{ x: 0.08, y: 0.82, w: 0.84, h: 0.12 }, { x: 0.62, y: 0.06, w: 0.3, h: 0.05 }],
  })
  dirty = true

  page = await launchChrome({ profile: 'server/data/.tmp-sheet-chrome', base: BASE, token: TOKEN })

  /* ---------------- ① 答案遮挡 ---------------- */
  await page.goto(`${BASE}/sheet/${sheetId}?page=${pages[0].id}`)
  await waitFor(() => page.evalInPage(EVAL.covers).then(n => n >= 2).catch(() => false),
    { timeout: 20000, label: '遮挡块渲染' })
  const coverCount = await page.evalInPage(EVAL.covers)
  check('1 遮挡块按页渲染（2 块）', coverCount === 2, `DOM 里 ${coverCount} 块`)

  const opaque = await page.evalInPage(`(() => {
    const el = document.querySelector('.sheet-cover')
    if (!el) return ''
    const st = getComputedStyle(el)
    return st.backgroundColor + '|' + st.backgroundImage.slice(0, 30)
  })()`)
  check('2 遮挡块不透明（不是半透明蒙层）',
    /rgba?\(\s*23[0-9]/.test(opaque) && !/rgba\([^)]*0\.\d\)/.test(opaque.split('|')[0]),
    opaque.split('|')[0])

  await page.evalInPage(`document.querySelector('.sheet-cover').click()`)
  await sleep(120)
  check('3 点一下临时显形（peeking）', (await page.evalInPage(EVAL.peeking)) === 1)
  await sleep(3200)
  check('4 3 秒后自动盖回', (await page.evalInPage(EVAL.peeking)) === 0)

  await page.evalInPage(`document.querySelector('.answer-toggle').click()`)
  await sleep(150)
  check('5 顶栏「显示答案」把遮挡全部撤掉', (await page.evalInPage(EVAL.covers)) === 0)
  await page.evalInPage(`document.querySelector('.answer-toggle').click()`)
  await sleep(150)
  check('6 再点一次恢复遮挡', (await page.evalInPage(EVAL.covers)) === 2)

  /* ---------------- ② AI 自动切题 ---------------- */
  const beforeQ = await page.evalInPage(EVAL.qBoxes)
  await page.evalInPage(`document.querySelector('.ai-btn').click()`)
  await sleep(150)
  await page.evalInPage(`Array.from(document.querySelectorAll('.ai-menu button')).find(b => b.textContent.includes('当前页')).click()`)
  await waitFor(() => page.evalInPage(`!!document.querySelector('.ai-bar')`).catch(() => false),
    { timeout: 180000, interval: 300, label: 'AI 切题返回' })
  const barText = await page.evalInPage(`document.querySelector('.ai-bar')?.textContent || ''`)
  const aiCount = Number((barText.match(/(\d+)\s*道题/) || [])[1] || 0)
  check('7 AI 切出题目区（>0）', aiCount > 0, `${aiCount} 道 · ${barText.trim().slice(0, 30)}`)

  await page.evalInPage(`document.querySelector('.ai-bar-ok').click()`)
  await sleep(300)
  const afterQ = await page.evalInPage(EVAL.qBoxes)
  check('8 确认后画布上出现题目框', afterQ === beforeQ + aiCount, `${beforeQ} → ${afterQ}`)
  await sleep(1200) // 等防抖保存落库
  const savedRow = await api(`/api/text/${sheetId}`)
  const savedQ = (savedRow.annotations || []).filter((a) => a.kind === 'q').length
  check('9 题目标注已落库（kind=q）', savedQ === aiCount, `库里 ${savedQ} 条`)

  /* ---------------- ③ 错题本 + SRS ---------------- */
  await page.goto(`${BASE}/sheet/wrong`, 'window.scrollTo(0,0)')
  await waitFor(() => page.evalInPage(EVAL.wrongCards).then(n => n >= 1).catch(() => false),
    { timeout: 20000, label: '错题卡片渲染' })
  const cards = await page.evalInPage(EVAL.wrongCards)
  const hasSeed = await page.evalInPage(`document.body.innerText.includes('E2E 测试错题')`)
  check('10 错题本聚合出标注里的错题', cards >= 1 && hasSeed, `${cards} 张`)

  // 缩略图是 background-image（原卷 + background-position 裁切），
  // 所以不能只看 DOM 属性 —— 真去加载一次，确认这张图确实能拿到。
  const thumbOk = await page.evalInPage(`(async () => {
    const el = document.querySelector('.wp-thumb')
    if (!el) return 'no-thumb'
    const bg = getComputedStyle(el).backgroundImage
    const m = bg.match(/url\\(["']?(.*?)["']?\\)/)
    if (!m) return 'no-url'
    const url = m[1]
    const loaded = await new Promise((res) => {
      const im = new Image()
      im.onload = () => res(true)
      im.onerror = () => res(false)
      im.src = url
    })
    return (loaded ? 'ok|' : 'bad|') + url.replace(location.origin, '')
  })()`)
  check('11 卡片用原卷裁出题目缩略图（图片可加载）',
    thumbOk.startsWith('ok|') && thumbOk.includes('/api/file/'),
    thumbOk.slice(0, 60))

  await page.evalInPage(`document.querySelector('.wp-card').click()`)
  await waitFor(() => page.evalInPage(`!!document.querySelector('.wp-modal')`), { timeout: 5000, label: '复习浮层' })
  const modalBox = await page.evalInPage(`!!document.querySelector('.wp-sheet-box')`)
  check('12 浮层里在原卷上框出该题', modalBox)

  const dueBefore = Number((await page.evalInPage(`document.body.innerText`)).match(/今日到期\s*(\d+)/)?.[1] || 0)
  await page.evalInPage(`document.querySelector('.wp-grade.good').click()`)
  await sleep(800)
  const dueAfter = Number((await page.evalInPage(`document.body.innerText`)).match(/今日到期\s*(\d+)/)?.[1] || 0)
  check('13 评分后今日到期数减少', dueAfter === Math.max(0, dueBefore - 1), `${dueBefore} → ${dueAfter}`)

  const listApi = await api('/api/sheet/wrong/list?due=0')
  const seedItem = listApi.items.find((i) => i.id === W_ID)
  check('14 SRS 状态已推进（复习次数/下次到期）',
    !!seedItem && seedItem.reviewCount >= 1 && !!seedItem.dueAt,
    seedItem ? `reviewCount=${seedItem.reviewCount} dueAt=${String(seedItem.dueAt).slice(11, 19)}` : '找不到该错题')
} catch (e) {
  check('执行异常', false, String(e?.message || e))
} finally {
  // 复原：annotations 与 covers 都回到跑测试之前的样子
  if (dirty && sheetId) {
    try {
      await post(`/api/sheet/${sheetId}/annotations`, { annotations: origAnnotations })
      const row2 = await api(`/api/text/${sheetId}`)
      const pg = (row2.segments || [])[0]
      if (pg) await post(`/api/sheet/${sheetId}/covers`, { pageId: pg.id, covers: origCovers })
      // 标注被复原后，错题本里那条测试记录由对账清理掉（列表接口内部会 sync）
      await api('/api/sheet/wrong/list?due=0')
      console.log('\n（已复原该试卷的标注与遮挡）')
    } catch (e) {
      console.error('复原失败，请手动检查：', e?.message)
    }
  }
  await page?.close()

  const failed = results.filter(r => !r.ok)
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
  if (failed.length) {
    console.log('失败项：' + failed.map(f => f.name).join(' / '))
    process.exitCode = 1
  }
}
