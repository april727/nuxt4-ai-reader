/**
 * 阅读页「连续竖图并排」回归（真 Chrome + CDP）
 *
 * 场景：同一页教材被切成三四块分别插入，markdown 里是一串独立的 `![](url)`，
 * 各占一个 <p>。`.para-text img{max-width:100%}` 让每张按原宽独占一行，
 * 三张竖切书页（宽高比 0.6~0.8）就是三屏高 —— 用户的原话是"竖向排列、特别长"。
 *
 * 断言只能落在像素上：DOM 里有没有 .md-figure-group 不代表用户看到的是横排
 * （可能被 CSS 覆盖回 block，或者列宽塌成 0）。
 *
 * 覆盖：
 *   1  竖图组被识别并合并（存在 .md-figure-group）
 *   2  组内图片**同一行**（top 差 ≤ 4px）
 *   3  列宽等分（三列宽度差 ≤ 2px）
 *   4  图片不溢出自己的格子（宽 ≤ 列宽 + 1）
 *   5  组的总高度 ≤ 1.2 屏（合并前是 3 屏）
 *   6  横图组**不**合并（三张 16:9 并排每张只剩 290px，细节全丢）
 *   7  移动端（390px）：图组可横向滑动（scrollWidth > clientWidth）
 *
 * 用法：node server/scripts/verify-figure-groups.mjs
 * 需要服务在跑（npm run dev / npm start）。
 */
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
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

/**
 * 挑两篇文章：一篇组内平均是竖图（应合并），一篇是横图（不应合并）。
 * 直接扫库 + sharp 读真实尺寸，不依赖任何硬编码 id。
 */
async function pickTexts() {
  const db = new DatabaseSync('server/data/reader.db', { readOnly: true })
  const rows = db.prepare('SELECT id, segments FROM texts').all()
  const cands = []
  for (const r of rows) {
    if (!r.segments) continue
    let arr
    try { arr = JSON.parse(r.segments) } catch { continue }
    for (const p of arr) {
      const md = (p.text || '').match(/!\[[^\]]*\]\(([^)]+)\)/g) || []
      if (md.length < 2) continue
      const ratio = []
      for (const m of md) {
        const u = m.slice(m.indexOf('(') + 1, -1)
        const rel = u.startsWith('/api/file/') ? decodeURIComponent(u.slice('/api/file/'.length)) : u
        const fp = path.join('server/data/files', rel)
        if (!existsSync(fp)) continue
        try {
          const meta = await sharp(fp).metadata()
          ratio.push(meta.width / meta.height)
        } catch { /* 跳过坏图 */ }
      }
      if (ratio.length < 2) continue
      cands.push({ id: r.id, n: md.length, avg: ratio.reduce((a, b) => a + b, 0) / ratio.length })
    }
  }
  db.close()
  cands.sort((a, b) => b.n - a.n)
  const tall = cands.find((c) => c.avg < 1.0)
  const wide = cands.find((c) => c.avg > 1.3)
  return { tall, wide }
}

const { tall, wide } = await pickTexts()
if (!tall) {
  console.error('库里没有「同段多张竖图」的文章，先插三张竖图再跑')
  process.exit(1)
}
console.log(`竖图文章：${tall.id}（${tall.n} 张，平均比例 ${tall.avg.toFixed(2)}）`)
if (wide) console.log(`横图文章：${wide.id}（${wide.n} 张，平均比例 ${wide.avg.toFixed(2)}）`)

const BASE = await resolveBase()
let page = null
try {
  page = await launchChrome({ profile: 'server/data/.tmp-e2e-fig', base: BASE, token: TOKEN })

  // ── 桌面：竖图组应横排 ──
  await page.goto(`${BASE}/read/${tall.id}`)
  await waitFor(async () => (await page.evalInPage('document.querySelectorAll(".para-block").length')) > 0,
    { timeout: 30000, interval: 400, label: '正文渲染' })
  // 等不到图组不算异常：让后面的断言明确失败，比抛「脚本异常」更好定位
  await waitFor(async () => (await page.evalInPage('document.querySelectorAll(".md-figure-group").length')) > 0,
    { timeout: 20000, interval: 400, label: '图组生成' }).catch(() => {})

  const g = await page.evalInPage(`(() => {
    const el = document.querySelector('.md-figure-group')
    if (!el) return null
    const imgs = [...el.querySelectorAll('img')]
    const rects = imgs.map((i) => i.getBoundingClientRect())
    // 列宽带 px 单位，必须 parseFloat；Number('439.6px') 是 NaN（NaN 经 CDP 序列化还会变 null）
    const cols = getComputedStyle(el).gridTemplateColumns.split(' ').map(parseFloat)
    return {
      n: imgs.length,
      cols,
      tops: rects.map((r) => Math.round(r.top)),
      widths: rects.map((r) => Math.round(r.width)),
      boxTop: Math.round(el.getBoundingClientRect().top),
      boxH: Math.round(el.getBoundingClientRect().height),
      vh: window.innerHeight,
    }
  })()`)

  check('竖图组被识别并合并', !!g && g.n >= 2, g ? `${g.n} 张` : '没找到 .md-figure-group')

  if (g) {
    const sameRow = Math.max(...g.tops) - Math.min(...g.tops) <= 4
    check('组内图片在同一行（top 差 ≤ 4px）', sameRow, `tops=${g.tops.join('/')}`)

    const colEq = g.cols.length >= 2 && Math.max(...g.cols) - Math.min(...g.cols) <= 2
    check('列宽等分（差 ≤ 2px）', colEq, g.cols.map((n) => n.toFixed(0)).join(' / '))

    const overflow = g.widths.filter((w, i) => w > (g.cols[i] || 0) + 1)
    check('图片不溢出自己的格子', overflow.length === 0,
      `${g.n} 张里 ${overflow.length} 张超宽`)

    // 合并前三张竖图≈3 屏；合并后应压到 1.2 屏以内
    check('图组高度 ≤ 1.2 屏（合并前约 3 屏）', g.boxH <= g.vh * 1.2,
      `高 ${g.boxH}px / 视口 ${g.vh}px`)
  }

  // ── 桌面：横图组不应合并 ──
  if (wide) {
    await page.goto(`${BASE}/read/${wide.id}`)
    await waitFor(async () => (await page.evalInPage('document.querySelectorAll(".para-block").length')) > 0,
      { timeout: 30000, interval: 400, label: '正文渲染' })
    // 给图组逻辑留出图片解码后的重试窗口
    await sleep(2500)
    const wideGroups = await page.evalInPage(`document.querySelectorAll('.md-figure-group').length`)
    check('横图组不合并（三张 16:9 并排会太小）', wideGroups === 0, `${wideGroups} 组`)
  } else {
    check('横图组不合并（三张 16:9 并排会太小）', true, '库里没有横图组样本，跳过')
  }

  // ── 移动端：图组可横滑 ──
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  })
  await page.goto(`${BASE}/read/${tall.id}`)
  // 等不到图组不算异常：让后面的断言明确失败，比抛「脚本异常」更好定位
  await waitFor(async () => (await page.evalInPage('document.querySelectorAll(".md-figure-group").length')) > 0,
    { timeout: 20000, interval: 400, label: '图组生成' }).catch(() => {})
  await sleep(800)
  const m = await page.evalInPage(`(() => {
    const el = document.querySelector('.md-figure-group')
    if (!el) return null
    return { scrollW: el.scrollWidth, clientW: el.clientWidth }
  })()`)
  check('移动端图组可横向滑动', !!m && m.scrollW > m.clientW,
    m ? `内容 ${m.scrollW}px / 视口 ${m.clientW}px` : '没找到图组')
} catch (e) {
  console.error('\n脚本异常：', e?.message || e)
  check('脚本无异常', false)
} finally {
  if (page) await page.close()
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过${failed ? `，${failed} 项失败` : ''}`)
process.exit(failed ? 1 : 0)
