/**
 * 原页划词 → 建标记 回归（真 Chrome + CDP）
 *
 * 这条链路是全套里最容易「看起来没坏、其实没接上」的一段：
 *   选区 → PDF 坐标 → /api/pdf/locate 换成段落偏移 → 复用正文的建标记逻辑 → 原页高亮刷新
 * 任何一环断掉，用户看到的都是「选了字、点了按钮、什么都没发生」。
 *
 * 断言：
 *   1  文字层铺出来了，且每个 span 都是绝对定位（scoped 样式没穿透时会是普通行内流）
 *   2  span 是透明的（不然黑字会压在画面上）
 *   3  选区能让工具条出现（说明 select-text 事件确实发出去了）
 *   4  工具条压在浮层之上（z-index 高于 6000，否则被灰底吃掉）
 *   5  点「词」之后库里确实多了一条标记，且偏移能切出选区里的词
 *   6  新标记马上在原页上有高亮（本地补的矩形，不等服务端）
 *   7  标记弹窗浮在浮层之上（否则用户看不到解释）
 *
 * 说明：选区用 Range 程序化构造 —— 代码路径和真实拖选完全一样（onSelectionEnd
 * 读的都是 window.getSelection），只是省掉模拟鼠标轨迹这一步。
 *
 * 用法：node server/scripts/verify-pdf-select.mjs [textId]
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { launchChrome, resolveBase, sleep, waitFor } from './lib/cdp.mjs'
import { q, q1, api } from './_testdb.mjs'

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

// ── 挑样本：有坐标表、有标记的 PDF ──
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

const before = await q1('SELECT marks, segments FROM texts WHERE id=?', [textId])
const marksBefore = JSON.parse(before.marks || '[]')
/** 原页阶段的对照基线（正文阶段也会建一条，不能拿最初那份比） */
let baseline = marksBefore
const segsBefore = JSON.parse(before.segments || '[]')
const createdIds = []

const b = await launchChrome({ port: 9446, profile: 'server/data/.tmp-pdfsel', base: BASE, token: TOKEN })
const page = b

try {
  await page.goto(`${BASE}/read/${textId}`)
  await waitFor(async () => (await page.evalInPage('document.querySelectorAll(".para-block").length')) > 0,
    { timeout: 30000, interval: 400, label: '正文渲染' })

  // ── 0. 先验正文划词没被带坏 ──
  // 原页划词复用的是同一套工具条和 createMark，改这边最容易顺手打断那边，
  // 而正文划词是每天在用的主路径，必须一起看着
  const txtSel = await page.evalInPage(`(() => {
    const block = [...document.querySelectorAll('.para-block')].find((b) => {
      const t = b.querySelector('.para-text')
      return t && t.firstChild && t.firstChild.nodeType === 3 && t.firstChild.length > 40
    })
    if (!block) return { ok: false }
    const node = block.querySelector('.para-text').firstChild
    const r = document.createRange()
    r.setStart(node, 0)
    r.setEnd(node, 12)
    const s = window.getSelection()
    s.removeAllRanges()
    s.addRange(r)
    block.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return { ok: true, text: s.toString().trim() }
  })()`)
  await waitFor(async () => await page.evalInPage(`!!document.querySelector('.sel-toolbar')`),
    { timeout: 12000, interval: 300, label: '正文选区工具条' })
  const txtBarZ = await page.evalInPage(`(() => {
    const el = document.querySelector('.sel-toolbar')
    return el ? +getComputedStyle(el).zIndex : null
  })()`)
  check('正文划词工具条照旧（且仍是普通层级）', txtSel.ok && txtBarZ === 1500, `z-index ${txtBarZ}`)
  await page.evalInPage(`[...document.querySelectorAll('.sel-toolbar .sel-btn')].find((b) => b.title === '标记为生词').click()`)
  await waitFor(async () => await page.evalInPage(`!!document.querySelector('.mark-popup')`),
    { timeout: 12000, interval: 300, label: '正文标记弹窗' })
  const txtAdded = (await q1('SELECT marks FROM texts WHERE id=?', [textId]))
  const txtMark = JSON.parse(txtAdded.marks || '[]').find((m) => !marksBefore.some((x) => x.id === m.id))
  if (txtMark) createdIds.push(txtMark.id)
  check('正文划词仍能建出标记', !!txtMark, txtMark ? JSON.stringify(txtMark.text) : '没建出来')
  // 关掉弹窗，免得挡住后面的浮层
  await page.evalInPage(`(() => { const b = document.querySelector('.mark-popup .mp-close-btn'); if (b) b.click(); return true })()`)
  await sleep(600)
  const reMarks = await q1('SELECT marks FROM texts WHERE id=?', [textId])
  baseline = JSON.parse(reMarks.marks || '[]')

  await page.evalInPage(`document.querySelector('[title="查看 PDF 原文"]').click()`)
  await waitFor(async () => (await page.evalInPage('document.querySelectorAll(".pdfv-text span").length')) > 10,
    { timeout: 25000, interval: 400, label: '文字层' })
  await sleep(600)

  // ── 1/2. 文字层本身 ──
  const layer = await page.evalInPage(`(() => {
    const spans = [...document.querySelectorAll('.pdfv-text span')]
    const cs = spans.map((s) => getComputedStyle(s))
    return {
      n: spans.length,
      absolute: cs.filter((c) => c.position === 'absolute').length,
      transparent: cs.filter((c) => /rgba\\(0, 0, 0, 0\\)|transparent/.test(c.color)).length,
    }
  })()`)
  check('文字层铺出来了（>10 个 span）', layer.n > 10, `${layer.n} 个`)
  check('每个 span 都是绝对定位', layer.absolute === layer.n, `${layer.absolute}/${layer.n}`)
  check('span 是透明的（不压画面）', layer.transparent === layer.n, `${layer.transparent}/${layer.n}`)

  // ── 3. 造一个选区 ──
  const sel = await page.evalInPage(`(() => {
    // 只挑正文行：标题行（全大写、字距大）在段落文本里没有对应内容，
    // 选它一定定位失败 —— 那验的是失败路径，不是主链路
    const spans = [...document.querySelectorAll('.pdfv-text span')]
      .filter((s) => /[a-z]{3}/.test(s.textContent))
    const byTop = new Map()
    for (const s of spans) {
      const t = s.style.top
      if (!byTop.has(t)) byTop.set(t, [])
      byTop.get(t).push(s)
    }
    let picked = null
    for (const [, line] of byTop) {
      const ok = line.filter((s) => s.textContent.trim().length > 2)
      if (ok.length >= 3) { picked = ok.slice(0, 3); break }
    }
    if (!picked) return { ok: false }
    const r = document.createRange()
    r.setStart(picked[0].firstChild, 0)
    const last = picked[picked.length - 1]
    r.setEnd(last.firstChild, last.firstChild.length)
    const s = window.getSelection()
    s.removeAllRanges()
    s.addRange(r)
    document.querySelector('.pdfv-stage').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return { ok: true, text: s.toString().replace(/\\s+/g, ' ').trim() }
  })()`)
  check('能在原页上造出选区', sel.ok === true, sel.text || '没找到同一行的两个 span')

  await waitFor(async () => await page.evalInPage(`!!document.querySelector('.sel-toolbar')`),
    { timeout: 15000, interval: 300, label: '选区工具条' })
  const bar = await page.evalInPage(`(() => {
    const el = document.querySelector('.sel-toolbar')
    if (!el) return null
    return { z: +getComputedStyle(el).zIndex, label: el.textContent.includes('词'), btns: el.querySelectorAll('.sel-btn').length }
  })()`)
  check('工具条弹出（select-text 事件送达）', !!bar, bar ? `${bar.btns} 个按钮` : '没出现')
  check('工具条压在浮层之上', !!bar && bar.z > 6000, `z-index ${bar?.z}`)

  const hlBefore = await page.evalInPage(`document.querySelectorAll('.pdfv-hl').length`)

  // ── 5. 点「词」建标记 ──
  await page.evalInPage(`[...document.querySelectorAll('.sel-toolbar .sel-btn')].find((b) => b.title === '标记为生词').click()`)
  await waitFor(async () => await page.evalInPage(`!!document.querySelector('.mark-popup')`),
    { timeout: 15000, interval: 300, label: '标记弹窗' })
  await sleep(900)

  const row = await q1('SELECT marks FROM texts WHERE id=?', [textId])
  const marksAfter = JSON.parse(row.marks || '[]')
  const added = marksAfter.filter((m) => !baseline.some((x) => x.id === m.id))
  added.forEach((m) => createdIds.push(m.id))

  const mk = added[0]
  const seg = mk ? segsBefore.find((s) => s.id === mk.paragraphId) : null
  const sliced = seg && mk ? seg.text.slice(mk.startOffset, mk.endOffset) : ''
  const toks = (v) => (String(v).toLowerCase().match(/[a-z0-9]+/g) || [])
  const selToks = toks(sel.text)
  const gotToks = toks(sliced)
  const covered = gotToks.length > 0 && gotToks.every((t) => selToks.includes(t))
  check('库里多了一条标记', added.length === 1, `${added.length} 条${mk ? '：' + JSON.stringify(mk.text).slice(0, 40) : ''}`)
  check('偏移切出来的就是选区里的词', covered,
    `选区 ${JSON.stringify(sel.text).slice(0, 46)} → 段落切片 ${JSON.stringify(sliced).slice(0, 46)}`)

  // ── 6. 原页高亮立刻刷新 ──
  const hlAfter = await page.evalInPage(`document.querySelectorAll('.pdfv-hl').length`)
  const grown = hlAfter - hlBefore
  // 一条标记可能跨行 = 多个框，所以按「至少多出 1 个」判；但框必须压在字上，
  // 光有元素等于没断言（整体偏出页外也是 0 个墨点）
  const inks = await page.evalInPage(`(() => {
    const cv = document.querySelector('.pdfv-canvas')
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    const dpr = cv.width / parseFloat(cv.style.width || cv.width)
    const stage = document.querySelector('.pdfv-stage').getBoundingClientRect()
    return [...document.querySelectorAll('.pdfv-hl')].map((el) => {
      const r = el.getBoundingClientRect()
      const x = Math.max(0, Math.round((r.left - stage.left) * dpr))
      const y = Math.max(0, Math.round((r.top - stage.top) * dpr))
      const w = Math.min(cv.width - x, Math.round(r.width * dpr))
      const h = Math.min(cv.height - y, Math.round(r.height * dpr))
      if (w <= 0 || h <= 0) return -1
      const d = ctx.getImageData(x, y, w, h).data
      let dark = 0
      for (let i = 0; i < d.length; i += 4) if (d[i] < 140 && d[i + 1] < 140 && d[i + 2] < 140) dark++
      return dark / (d.length / 4)
    })
  })()`)
  const fresh = inks.slice(-Math.max(grown, 1))
  check('新标记立刻在原页高亮', grown >= 1 && fresh.every((v) => v > 0.03),
    `${hlBefore} → ${hlAfter}（新增 ${grown} 框，墨迹 ${fresh.map((v) => (v * 100).toFixed(1) + '%').join('/')}）`)

  // ── 7. 弹窗层级 ──
  const pop = await page.evalInPage(`(() => {
    const el = document.querySelector('.mark-popup')
    return el ? +getComputedStyle(el).zIndex : null
  })()`)
  check('标记弹窗浮在浮层之上', !!pop && pop > 6000, `z-index ${pop}`)
} finally {
  await b.close()
  // 复原：删掉本轮新建的标记（只动 marks 列，不碰 segments）
  if (createdIds.length) {
    const keep = marksBefore
    try {
      await api('/api/text/update', { method: 'POST', body: JSON.stringify({ id: textId, marks: keep }) })
      console.log(`\n已复原：移除本轮新建的 ${createdIds.length} 条标记`)
    } catch (e) {
      console.log(`\n复原失败，需手工清理标记：${createdIds.join(', ')} —— ${String(e).slice(0, 120)}`)
    }
  }
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${failed === 0 ? '全部通过' : '有失败项'}：${results.length - failed} 通过 / ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
