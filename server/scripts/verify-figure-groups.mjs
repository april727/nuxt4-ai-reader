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
 *   3  每张都是缩略图（≤168px）
 *   4  缩略图紧邻成条（相邻间距 ≤ 8px，不铺满栏宽）
 *   5  组的总高度只占一行（≤190px；合并前是 3 屏）
 *   6  横图组**也**合并成一条（都缩略图了，堆成竖列只会右边空一片）
 *   7  移动端（390px）：缩略图 ≤108px 且不需要横滑
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
    // 相邻两张之间的水平空隙：证明是"挨着的缩略图条"，而不是铺满整行的大格子
    const sorted = [...rects].sort((a, b) => a.left - b.left)
    const gaps = []
    for (let i = 1; i < sorted.length; i++) gaps.push(Math.round(sorted[i].left - sorted[i - 1].right))
    return {
      n: imgs.length,
      tops: rects.map((r) => Math.round(r.top)),
      widths: rects.map((r) => Math.round(r.width)),
      heights: rects.map((r) => Math.round(r.height)),
      gaps,
      boxH: Math.round(el.getBoundingClientRect().height),
      vh: window.innerHeight,
    }
  })()`)

  check('竖图组被识别并合并', !!g && g.n >= 2, g ? `${g.n} 张` : '没找到 .md-figure-group')

  if (g) {
    const sameRow = Math.max(...g.tops) - Math.min(...g.tops) <= 4
    check('组内图片在同一行（top 差 ≤ 4px）', sameRow, `tops=${g.tops.join('/')}`)

    // 竖图组现在是缩略图条：每张 ≤168×132，不再各自铺满一列
    const maxSide = Math.max(...g.widths, ...g.heights)
    check('每张都是缩略图（≤168px）', maxSide <= 169, `最大 ${maxSide}px`)

    const tight = g.gaps.every((d) => d >= 0 && d <= 8)
    check('缩略图紧邻成条（间距 ≤ 8px，不铺满栏宽）', g.gaps.length > 0 && tight, `gaps=${g.gaps.join('/')}`)

    // 合并前三张竖图≈3 屏；缩略图条应该只占一行的零头
    check('图组高度只占一行（≤ 190px，合并前约 3 屏）', g.boxH <= 190,
      `高 ${g.boxH}px / 视口 ${g.vh}px`)
  }

  // ── 桌面：横图组同样合并（都是缩略图，堆成竖列会空一大片）──
  if (wide) {
    await page.goto(`${BASE}/read/${wide.id}`)
    await waitFor(async () => (await page.evalInPage('document.querySelectorAll(".para-block").length')) > 0,
      { timeout: 30000, interval: 400, label: '正文渲染' })
    // 给图组逻辑留出图片解码后的重试窗口
    await sleep(2500)
    const wg = await page.evalInPage(`(() => {
      const el = document.querySelector('.md-figure-group')
      if (!el) return { groups: 0 }
      const rects = [...el.querySelectorAll('img')].map((i) => i.getBoundingClientRect())
      const sorted = [...rects].sort((a, b) => a.left - b.left)
      const gaps = []
      for (let i = 1; i < sorted.length; i++) gaps.push(Math.round(sorted[i].left - sorted[i - 1].right))
      return {
        groups: document.querySelectorAll('.md-figure-group').length,
        n: rects.length,
        rows: new Set(rects.map((r) => Math.round(r.top))).size,
        maxW: Math.round(Math.max(...rects.map((r) => r.width))),
        gaps,
      }
    })()`)
    check('横图组也合并成缩略图条', wg.groups >= 1 && wg.n >= 2, `${wg.groups} 组 / ${wg.n} 张`)
    check('横图缩略图同一行且不超 168px', wg.rows === 1 && wg.maxW <= 169,
      `${wg.rows} 行，最宽 ${wg.maxW}px，gaps=${(wg.gaps || []).join('/')}`)
  } else {
    check('横图组也合并成缩略图条', true, '库里没有横图组样本，跳过')
    check('横图缩略图同一行且不超 168px', true, '跳过')
  }

  // ── 移动端：缩略图再收一档，仍并排（不再需要横滑）──
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
    const imgs = [...el.querySelectorAll('img')]
    const rects = imgs.map((i) => i.getBoundingClientRect())
    return {
      max: Math.max(...rects.map((r) => Math.max(r.width, r.height))),
      tops: rects.map((r) => Math.round(r.top)),
      scrollW: el.scrollWidth, clientW: el.clientWidth,
    }
  })()`)
  check('手机缩略图 ≤108px', !!m && m.max <= 109, m ? `最大 ${Math.round(m.max)}px` : '没找到图组')
  check('手机图组不需要横滑（缩略图直接并排）', !!m && m.scrollW <= m.clientW + 1,
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
