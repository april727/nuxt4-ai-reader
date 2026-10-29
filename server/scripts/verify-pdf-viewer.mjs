/**
 * PDF 原页查看器回归（真 Chrome + CDP）
 *
 * 这一层验的是**渲染**：坐标算得对不对、高亮画没画在字上、翻页缩放会不会崩。
 * 坐标本身准不准由 verify-pdf-anchors.mjs 用文本回读证明，这里不重复。
 *
 * 断言：
 *   1  打开后 canvas 真的有内容（采样暗像素，排除"白板一张"）
 *   2  pageCount 与后端一致
 *   3  高亮 DOM 数量 == anchors 里该页矩形数
 *   4  **每个高亮框内都有墨迹**（框在字上，不是飘在空白处），且页面边距处没墨
 *   5  高亮不越出页面
 *   6  翻页：页码 +1，canvas 重绘（像素签名变化）
 *   7  缩放：+ 之后 canvas 显示宽度变大，且高亮仍与文字重合
 *   8  Esc 关闭
 *   9  段落「在原文中定位」跳到该段所在页，并出现闪烁框
 *  10  标记弹窗「在原文中查看」跳到该标记所在页（挑第 2 页之后的标记，防"永远停在第 1 页也绿"）
 *  11  该标记的高亮框落在字上
 *
 * 第 4 条是核心：只断言"有高亮元素"等于没断言 —— 位置整体偏 20px 也全绿。
 *
 * 用法：node server/scripts/verify-pdf-viewer.mjs [textId]
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { launchChrome, resolveBase, sleep, waitFor } from './lib/cdp.mjs'
import { q } from './_testdb.mjs'

const env = readFileSync('.env', 'utf8').split(/\r?\n/).reduce((a, l) => {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) a[m[1]] = m[2].replace(/^["']|["']$/g, '')
  return a
}, {})
const TOKEN = createHash('sha256').update(env.SITE_PASSWORD || '').digest('hex')

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok })
  console.log(`${ok ? '  ok ' : '  FAIL'}  ${name}${extra ? '  · ' + extra : ''}`)
}

const BASE = await resolveBase()

// ── 挑样本：有坐标表、标记最多的一篇 ──
let textId = process.argv[2]
if (!textId) {
  const rows = await q(`SELECT id, title, marks FROM texts WHERE filePath LIKE '%.pdf' AND deletedAt IS NULL`)
  const ranked = rows.map((r) => {
    let n = 0
    try { n = JSON.parse(r.marks || '[]').filter((m) => !m.deletedAt).length } catch {}
    return { id: r.id, title: r.title, n }
  }).sort((a, b) => b.n - a.n)
  if (!ranked.length) { console.log('库里没有 PDF 文章，跳过'); process.exit(0) }
  textId = ranked[0].id
  console.log(`样本：${ranked[0].title}（${textId}，${ranked[0].n} 条标记）\n`)
}

const anchors = await (await fetch(`${BASE}/api/pdf/anchors?id=${textId}`, {
  headers: { cookie: `auth_token=${TOKEN}` },
})).json()
if (!anchors.ok) { console.log('锚点接口不可用：', anchors.reason); process.exit(1) }

const b = await launchChrome({ port: 9445, profile: 'server/data/.tmp-pdfv', base: BASE, token: TOKEN })
const page = b

/** 页面内通用的渲染采样 */
const PROBE = `(() => {
  const cv = document.querySelector('.pdfv-canvas')
  if (!cv) return null
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  const dpr = cv.width / parseFloat(cv.style.width || cv.width)
  const stage = document.querySelector('.pdfv-stage').getBoundingClientRect()
  const ink = (r) => {
    const x = Math.max(0, Math.round((r.left - stage.left) * dpr))
    const y = Math.max(0, Math.round((r.top - stage.top) * dpr))
    const w = Math.min(cv.width - x, Math.round(r.width * dpr))
    const h = Math.min(cv.height - y, Math.round(r.height * dpr))
    if (w <= 0 || h <= 0) return -1
    const d = ctx.getImageData(x, y, w, h).data
    let dark = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < 140 && d[i + 1] < 140 && d[i + 2] < 140) dark++
    }
    return dark / (d.length / 4)
  }
  const hls = [...document.querySelectorAll('.pdfv-hl:not(.pdfv-hl--flash)')]
  return {
    canvasW: cv.width,
    canvasH: cv.height,
    cssW: parseFloat(cv.style.width),
    page: (document.querySelector('.pdfv-pageinput') || {}).value,
    total: (document.querySelector('.pdfv-pagetotal') || {}).textContent,
    hlCount: hls.length,
    flash: !!document.querySelector('.pdfv-hl--flash'),
    // 页面四角之一通常是页边距，用来对照"空白处不该有墨"
    blankInk: (() => {
      const r = document.querySelector('.pdfv-stage').getBoundingClientRect()
      return ink({ left: r.left + 4, top: r.top + 4, width: 18, height: 18 })
    })(),
    inks: hls.map((el) => ink(el.getBoundingClientRect())),
    overflow: hls.filter((el) => {
      const r = el.getBoundingClientRect()
      return r.left < stage.left - 1 || r.top < stage.top - 1
        || r.right > stage.right + 1 || r.bottom > stage.bottom + 1
    }).length,
  }
})()`

try {
  // 段落工具条默认关闭（paraActionsEnabled=false），先打开再进页面，
  // 否则「在原文中定位」按钮根本不在 DOM 里
  await page.goto(`${BASE}/read/${textId}`)
  await sleep(1200)
  await page.evalInPage(`localStorage.setItem('reader-para-actions-enabled','1')`)
  await page.goto(`${BASE}/read/${textId}`)
  await waitFor(async () => (await page.evalInPage('document.querySelectorAll(".para-block").length')) > 0,
    { timeout: 30000, interval: 400, label: '正文渲染' })

  // ── 1. 打开原页 ──
  await page.evalInPage(`document.querySelector('[title="查看 PDF 原文"]').click()`)
  await waitFor(async () => (await page.evalInPage('!!document.querySelector(".pdfv-canvas")')),
    { timeout: 20000, interval: 300, label: '原页 canvas' })
  await waitFor(async () => {
    const p = await page.evalInPage(PROBE)
    return p && p.hlCount >= 0 && p.total && p.total.includes(String(anchors.pageCount))
  }, { timeout: 20000, interval: 400, label: 'PDF 渲染完成' })
  await sleep(800)

  let s = await page.evalInPage(PROBE)
  check('原页 canvas 已渲染（尺寸正常）', !!s && s.canvasW > 300 && s.canvasH > 300,
    s ? `${s.canvasW}×${s.canvasH}` : '没拿到 canvas')
  check('总页数与后端一致', !!s && s.total === `/ ${anchors.pageCount}`, s?.total)

  // 页面主体必须有墨迹（全白说明渲染失败但 canvas 尺寸对）
  const bodyInk = await page.evalInPage(`(() => {
    const cv = document.querySelector('.pdfv-canvas')
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data
    let dark = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] < 140) dark++
    return dark / (d.length / 4)
  })()`)
  check('页面有实际内容（暗像素 > 1%）', bodyInk > 0.01, `${(bodyInk * 100).toFixed(2)}%`)

  // ── 2. 高亮数量与坐标表一致 ──
  const p1 = String(s.page)
  const expect1 = Object.values(anchors.marks).filter((rs) => rs.some((r) => r.p === Number(p1))).length
  check('高亮数量 == 该页标记数', s.hlCount === expect1, `DOM ${s.hlCount} / 期望 ${expect1}`)
  check('高亮不越出页面', s.overflow === 0, `${s.overflow} 个越界`)

  // ── 3. 核心：框里真的有墨迹 ──
  const valid = s.inks.filter((v) => v >= 0)
  const onText = valid.filter((v) => v > 0.03).length
  check('每个高亮框都压在文字上', valid.length > 0 && onText === valid.length,
    `${onText}/${valid.length} 框内有墨迹` + `（最少 ${(Math.min(...valid) * 100).toFixed(1)}%）`)
  check('页面边距处没有墨（对照，防整页偏移）', s.blankInk >= 0 && s.blankInk < 0.02,
    `${(s.blankInk * 100).toFixed(1)}%`)

  // ── 4. 翻页 ──
  await page.evalInPage(`document.querySelector('[title="下一页"]').click()`)
  await sleep(1600)
  const s2 = await page.evalInPage(PROBE)
  check('翻页生效（页码 +1）', s2.page === String(Number(p1) + 1), `${p1} → ${s2.page}`)
  const expect2 = Object.values(anchors.marks).filter((rs) => rs.some((r) => r.p === Number(s2.page))).length
  check('第 2 页高亮与该页标记数一致', s2.hlCount === expect2, `DOM ${s2.hlCount} / 期望 ${expect2}`)

  // ── 5. 缩放 ──
  const before = s2.cssW
  await page.evalInPage(`document.querySelector('[title="放大"]').click()`)
  await sleep(1600)
  const s3 = await page.evalInPage(PROBE)
  check('放大后页面变宽', s3.cssW > before, `${before.toFixed(0)}px → ${s3.cssW.toFixed(0)}px`)
  const v3 = s3.inks.filter((x) => x >= 0)
  check('放大后高亮仍压在文字上', v3.length > 0 && v3.every((x) => x > 0.03),
    `${v3.filter((x) => x > 0.03).length}/${v3.length}`)

  // ── 6. Esc 关闭 ──
  await page.evalInPage(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(500)
  const closed = await page.evalInPage(`!document.querySelector('.pdfv-canvas')`)
  check('Esc 关闭原页', closed === true)

  // ── 7. 从段落跳原页 ──
  await page.evalInPage(`(() => {
    const ps = [...document.querySelectorAll('.para-block')]
    const target = ps[Math.min(8, ps.length - 1)]
    target.scrollIntoView({ block: 'center' })
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    return true
  })()`)
  await sleep(600)
  const clicked = await page.evalInPage(`(() => {
    const ps = [...document.querySelectorAll('.para-block')]
    const target = ps[Math.min(8, ps.length - 1)]
    const btn = target.querySelector('[title="在原文中定位"]')
    if (!btn) return { ok: false, hasBtn: false }
    const pid = target.getAttribute('data-id') || ''
    btn.click()
    return { ok: true, pid }
  })()`)
  if (clicked.ok) {
    await sleep(3000)
    const s4 = await page.evalInPage(PROBE)
    const pid = clicked.pid
    const wantPage = anchors.paragraphs?.[pid]?.page
    check('段落「在原文中定位」跳对页', !!wantPage && s4.page === String(wantPage),
      `段 ${pid} → 第 ${s4.page} 页（期望 ${wantPage ?? '无锚点'}）`)
    check('该段出现闪烁定位框', s4.flash === true)
  } else {
    check('段落「在原文中定位」跳对页', false, '找不到按钮（工具条未开启？）')
    check('该段出现闪烁定位框', false, '同上')
  }

  // ── 8. 从标记弹窗跳原页（标的是词，不是段落，页码只能靠标记自己的矩形） ──
  await page.evalInPage(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(400)

  // 故意挑一个落在第 2 页及以后的标记：停在第 1 页也能绿的话，这条断言等于没写
  const markRows = await q(`SELECT marks FROM texts WHERE id = ?`, [textId])
  const markMeta = new Map()
  try {
    for (const m of JSON.parse(markRows[0]?.marks || '[]')) {
      if (!m.deletedAt) markMeta.set(m.id, m)
    }
  } catch { /* ignore */ }
  const target = Object.entries(anchors.marks)
    .map(([mid, rs]) => ({ mid, page: rs[0]?.p }))
    .filter((x) => x.page >= 2 && markMeta.get(x.mid)?.type !== 'note')
    .sort((a, b) => a.page - b.page)[0]

  if (!target) {
    check('标记弹窗「在原文中查看」跳对页', false, '没有落在第 2 页之后的标记可测')
    check('该标记在原页上被高亮', false, '同上')
  } else {
    const opened = await page.evalInPage(`(() => {
      const el = document.querySelector('mark[data-mark-id="${target.mid}"]')
      if (!el) return { ok: false, reason: '正文里没有这个标记的 DOM' }
      el.scrollIntoView({ block: 'center' })
      el.click()
      return { ok: true }
    })()`)
    await sleep(700)
    const hasBtn = await page.evalInPage(`!!document.querySelector('.mp-header [title="在原文中查看"]')`)
    if (!opened.ok || !hasBtn) {
      check('标记弹窗「在原文中查看」跳对页', false, opened.reason || '弹窗里没有入口按钮')
      check('该标记在原页上被高亮', false, '同上')
    } else {
      await page.evalInPage(`document.querySelector('.mp-header [title="在原文中查看"]').click()`)
      await waitFor(async () => (await page.evalInPage(PROBE))?.page === String(target.page),
        { timeout: 20000, interval: 400, label: '标记定位页' })
      // 页码先变、canvas 后画：必须等到真的有墨迹再断言，否则量到的是上一次的白板
      let s5 = null
      for (let i = 0; i < 25; i++) {
        s5 = await page.evalInPage(PROBE)
        if (s5 && s5.page === String(target.page) && s5.inks.some((x) => x > 0.03)) break
        await sleep(400)
      }
      check('标记弹窗「在原文中查看」跳对页', s5.page === String(target.page),
        `标记 → 第 ${s5.page} 页（期望 ${target.page}）`)
      // 高亮框必须在字上：只断言"有框"挡不住整体偏移
      const v5 = s5.inks.filter((x) => x >= 0)
      check('该标记在原页上被高亮',
        s5.hlCount >= 1 && v5.length > 0 && v5.every((x) => x > 0.03),
        `${s5.hlCount} 个高亮，${v5.filter((x) => x > 0.03).length}/${v5.length} 压在字上`)
    }
  }
} finally {
  await b.close()
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${failed === 0 ? '全部通过' : '有失败项'}：${results.length - failed} 通过 / ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
