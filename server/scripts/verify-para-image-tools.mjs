/**
 * 段落内嵌图片「贴图浮层 + 直接删除」回归（真 Chrome + CDP）
 *
 * 两条用户诉求：
 *   1. 点图 → 像截图工具那样把图"贴"在页面上：无遮罩、无翻页、无底部工具栏，
 *      自由拖动、滚轮缩放，双击或 Esc 关掉
 *   2. 段落里直接删图，不必进编辑模式改 markdown
 *
 * 断言全部落在**渲染结果和服务端数据**上，不看源码：
 * - 浮层背景必须 transparent 且 pointer-events:none（否则就是回到了黑屏灯箱）
 * - 翻页按钮 / 底部 HUD 必须为 0 个
 * - 100% 时拖动真的位移了；滚轮后 transform 倍率变大
 * - 光标下的那个像素在缩放后仍在光标下（锚点缩放）
 * - 双击、Esc 都能关闭
 * - 点一次 × 服务端**只少一张**（最容易静默退化的一条：客户端拿旧文本整段写回
 *   会把库里 3 张图写成 1 张 —— 实测踩过）
 *
 * 锚点缩放要用小视口测（500×800）：样本图只有 233px 宽，1440 视口下即使放到 8 倍
 * 也没超过视口宽度，pan 会被 clamp 成 0，锚点断言必然假失败。
 *
 * 会临时改动样本段落文本，跑完用 update-segment 复原（经浏览器同源 fetch，
 * Node 的 fetch 打 `http://[::1]` 会直接失败）。
 *
 * 用法：node server/scripts/verify-para-image-tools.mjs
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

const MD_IMG = /!\[[^\]]*\]\([^)]+\)/g

/** 挑一篇「同段 ≥3 张竖图」的文章：删掉一张后仍是图组，能顺带验证重组 */
async function pickSample() {
  const db = new DatabaseSync('server/data/reader.db', { readOnly: true })
  const rows = db.prepare('SELECT id, segments FROM texts').all()
  const cands = []
  for (const r of rows) {
    if (!r.segments) continue
    let arr
    try { arr = JSON.parse(r.segments) } catch { continue }
    for (const p of arr) {
      const md = (p.text || '').match(MD_IMG) || []
      if (md.length < 3) continue
      const ratios = []
      for (const m of md) {
        const u = m.slice(m.indexOf('(') + 1, -1)
        const rel = u.startsWith('/api/file/') ? decodeURIComponent(u.slice('/api/file/'.length)) : u
        const fp = path.join('server/data/files', rel)
        if (!existsSync(fp)) continue
        try {
          const meta = await sharp(fp).metadata()
          ratios.push(meta.width / meta.height)
        } catch { /* 坏图跳过 */ }
      }
      if (ratios.length < 3) continue
      const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length
      if (avg >= 1.0) continue // 只要竖图组，删一张后仍会重新合并
      cands.push({ textId: r.id, segId: p.id, n: md.length, avg, text: p.text })
    }
  }
  db.close()
  cands.sort((a, b) => b.n - a.n)
  return cands[0] || null
}

const sample = await pickSample()
if (!sample) {
  console.error('库里没有「同段 ≥3 张竖图」的段落，先插几张竖图再跑')
  process.exit(1)
}
console.log(`样本：${sample.textId} / ${sample.segId}（${sample.n} 张，平均比例 ${sample.avg.toFixed(2)}）`)

const BASE = await resolveBase()

let page = null
try {
  page = await launchChrome({ profile: 'server/data/.tmp-e2e-imgtools', base: BASE, token: TOKEN })
  await page.goto(`${BASE}/read/${sample.textId}`)
  await waitFor(async () => (await page.evalInPage('document.querySelectorAll(".para-block").length')) > 0,
    { timeout: 30000, interval: 400, label: '正文渲染' })
  // 图组/按钮是 MutationObserver 后处理出来的，等不到就让断言明确失败，别抛"脚本异常"
  await waitFor(async () => (await page.evalInPage('document.querySelectorAll(".para-img-del").length')) > 0,
    { timeout: 20000, interval: 400, label: '删除按钮' }).catch(() => {})

  // ── 1. 按钮：存在 / 隐藏 / 位置 ──
  const btnInfo = await page.evalInPage(`(() => {
    const imgs = [...document.querySelectorAll('.para-text img')]
    const wraps = [...document.querySelectorAll('.para-text .para-img-wrap')]
    const btns = [...document.querySelectorAll('.para-text .para-img-del')]
    const first = btns[0]
    const wrap = first ? first.closest('.para-img-wrap') : null
    const img = wrap ? wrap.querySelector('img') : null
    const cs = first ? getComputedStyle(first) : null
    let offset = null
    if (first && img) {
      const ir = img.getBoundingClientRect()
      const br = first.getBoundingClientRect()
      offset = { dx: Math.round(ir.right - br.right), dy: Math.round(br.top - ir.top), w: Math.round(br.width) }
    }
    return {
      imgs: imgs.length, wraps: wraps.length, btns: btns.length,
      opacity: cs ? cs.opacity : '', pe: cs ? cs.pointerEvents : '',
      offset,
    }
  })()`)

  check('每张段落图片都被 wrapper 包住', btnInfo.imgs > 0 && btnInfo.wraps === btnInfo.imgs,
    `${btnInfo.imgs} 张 / ${btnInfo.wraps} 个 wrapper`)
  check('每张段落图片都有删除按钮', btnInfo.btns === btnInfo.imgs,
    `${btnInfo.imgs} 张 / ${btnInfo.btns} 个按钮`)
  check('按钮默认隐藏（不干扰阅读）', btnInfo.opacity === '0' && btnInfo.pe === 'none',
    `opacity=${btnInfo.opacity} pointer-events=${btnInfo.pe}`)
  check('按钮贴在图片右上角（偏移 ≤ 12px，尺寸 ≤ 26px）',
    !!btnInfo.offset && btnInfo.offset.dx >= 0 && btnInfo.offset.dx <= 12 &&
    btnInfo.offset.dy >= 0 && btnInfo.offset.dy <= 12 && btnInfo.offset.w <= 26,
    btnInfo.offset ? `dx=${btnInfo.offset.dx} dy=${btnInfo.offset.dy} w=${btnInfo.offset.w}` : '没有按钮')

  // ── 2. 贴图浮层：无遮罩 / 无翻页 / 拖得动 / 滚轮缩放（小视口，见文件头说明）──
  await page.send('Emulation.setDeviceMetricsOverride', { width: 500, height: 800, deviceScaleFactor: 1, mobile: false })
  await page.goto(`${BASE}/read/${sample.textId}`)
  await waitFor(async () => (await page.evalInPage('document.querySelectorAll(".para-img-del").length')) > 0,
    { timeout: 20000, interval: 400, label: '删除按钮' }).catch(() => {})
  await sleep(500)

  const opened = await page.evalInPage(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms))
    const pane = document.querySelector('.reader-article-pane')
    pane.style.scrollBehavior = 'auto'
    const img = document.querySelector('.para-text img')
    img.scrollIntoView({ block: 'center' })
    await sleep(900)
    img.click()
    await sleep(800)
    const box = document.querySelector('.lb')
    const big = document.querySelector('.lb-img')
    if (!box || !big) return null
    const cs = getComputedStyle(box)
    const r = big.getBoundingClientRect()
    return {
      bg: cs.backgroundColor, pe: cs.pointerEvents,
      nav: document.querySelectorAll('.lb-nav').length,
      hud: document.querySelectorAll('.lb-hud').length,
      src: big.getAttribute('src') || '',
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
    }
  })()`)

  /** 贴图当前几何 + 缩放倍率（没有工具栏了，倍率从 transform 的矩阵里读） */
  const geo = () => page.evalInPage(`(() => {
    const big = document.querySelector('.lb-img')
    if (!big) return null
    const r = big.getBoundingClientRect()
    const m = new DOMMatrix(getComputedStyle(big).transform)
    return { x: r.left, y: r.top, w: r.width, h: r.height, zoom: +m.a.toFixed(3) }
  })()`)

  if (opened) {
    check('点图浮出贴图', true)
    check('没有黑色遮罩（页面照常可读、可点）',
      opened.bg === 'rgba(0, 0, 0, 0)' && opened.pe === 'none',
      `background=${opened.bg} pointer-events=${opened.pe}`)
    check('没有翻页、没有底部工具栏',
      opened.nav === 0 && opened.hud === 0, `nav=${opened.nav} hud=${opened.hud}`)
    check('贴图加载原图（不带 ?w=）', !!opened.src && !opened.src.includes('?w='),
      opened.src.split('/').pop())

    // 拖拽：用真鼠标事件（合成 PointerEvent 的 pointerId 非法，setPointerCapture 会抛）
    const g0 = await geo()
    const mx = g0.x + g0.w / 2
    const my = g0.y + g0.h / 2
    const mouse = (type, x, y, extra = {}) =>
      page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx, y: my, button: 'none' })
    await mouse('mousePressed', mx, my, { buttons: 1 })
    await mouse('mouseMoved', mx + 40, my + 20, { buttons: 1 })
    await mouse('mouseMoved', mx + 70, my + 40, { buttons: 1 })
    await mouse('mouseReleased', mx + 70, my + 40, { buttons: 0 })
    await sleep(350)
    const g1 = await geo()
    const move = { dx: Math.round(g1.x - g0.x), dy: Math.round(g1.y - g0.y), zoom: g1.zoom }
    // 100% 也能拖：贴图的意义就是把图挪到想对照的文字旁边
    check('100% 下即可拖动（位移 ≈ 70/40）',
      Math.abs(move.dx - 70) <= 6 && Math.abs(move.dy - 40) <= 6 && move.zoom === 1,
      `dx=${move.dx} dy=${move.dy} zoom=${move.zoom}`)

    // 滚轮缩放 + 光标锚点
    const wheel = (x, y, dy) =>
      page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy })
    const ax = g1.x + g1.w * 0.3
    const ay = g1.y + g1.h * 0.35
    const relOf = (g) => ({ x: (ax - g.x) / g.w, y: (ay - g.y) / g.h })
    const rel0 = relOf(g1)
    await wheel(ax, ay, -240)
    await sleep(320)
    const g2 = await geo()
    await wheel(ax, ay, -240)
    await sleep(320)
    const g3 = await geo()
    await wheel(ax, ay, -240)
    await sleep(360)
    const g4 = await geo()
    const rel1 = relOf(g4)
    check('滚轮放大生效（> 120%）', g1.zoom === 1 && g3.zoom > 1.2, `${g1.zoom} → ${g2.zoom} → ${g3.zoom}`)
    check('以光标为锚点缩放（偏移 ≤ 6%）',
      Math.abs(rel1.x - rel0.x) <= 0.06 && Math.abs(rel1.y - rel0.y) <= 0.06,
      `dx=${(Math.abs(rel1.x - rel0.x) * 100).toFixed(1)}% dy=${(Math.abs(rel1.y - rel0.y) * 100).toFixed(1)}%`)

    // 双击关闭（没有 × 按钮之后的两个关闭手势之一）
    const cxp = g4.x + g4.w / 2
    const cyp = g4.y + g4.h / 2
    await mouse('mousePressed', cxp, cyp, { buttons: 1, clickCount: 1 })
    await mouse('mouseReleased', cxp, cyp, { buttons: 0, clickCount: 1 })
    await mouse('mousePressed', cxp, cyp, { buttons: 1, clickCount: 2 })
    await mouse('mouseReleased', cxp, cyp, { buttons: 0, clickCount: 2 })
    await sleep(500)
    check('双击关闭贴图', (await page.evalInPage(`!document.querySelector('.lb')`)) === true)

    // Esc 关闭
    await page.evalInPage(`document.querySelector('.para-text img').click()`)
    await sleep(500)
    const reopened = await page.evalInPage(`!!document.querySelector('.lb-img')`)
    await page.evalInPage(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(450)
    const escClosed = await page.evalInPage(`!document.querySelector('.lb')`)
    check('Esc 关闭贴图', reopened === true && escClosed === true, `重开=${reopened} 关掉=${escClosed}`)
  } else {
    check('点图浮出贴图', false, '没找到 .lb-img')
    check('没有黑色遮罩（页面照常可读、可点）', false, '')
    check('没有翻页、没有底部工具栏', false, '')
    check('贴图加载原图（不带 ?w=）', false, '')
    check('100% 下即可拖动（位移 ≈ 70/40）', false, '')
    check('滚轮放大生效（> 120%）', false, '')
    check('以光标为锚点缩放（偏移 ≤ 6%）', false, '')
    check('双击关闭贴图', false, '')
    check('Esc 关闭贴图', false, '')
  }


  // ── 3. hover 后按钮可命中，点一次只少一张 ──
  const before = await page.evalInPage(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms))
    window.confirm = () => true
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await sleep(400)
    const pane = document.querySelector('.reader-article-pane')
    pane.style.scrollBehavior = 'auto'
    const seg = document.querySelector('.para-text[data-para-id="' + ${JSON.stringify(sample.segId)} + '"]')
    if (!seg) return null
    const img = seg.querySelector('img')
    pane.scrollTop = img.getBoundingClientRect().top + pane.scrollTop - 120
    await sleep(700)
    const r = img.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), pageImgs: seg.querySelectorAll('img').length }
  })()`)

  if (before) {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: before.x, y: before.y, button: 'none' })
    await sleep(600)
    const hover = await page.evalInPage(`(() => {
      const seg = document.querySelector('.para-text[data-para-id="' + ${JSON.stringify(sample.segId)} + '"]')
      const btn = seg.querySelector('.para-img-del')
      const cs = getComputedStyle(btn)
      const r = btn.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return {
        opacity: cs.opacity, pe: cs.pointerEvents,
        hit: !!hit && hit.classList.contains('para-img-del'),
        x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
      }
    })()`)

    check('悬停后按钮显形且可点击', hover.opacity === '1' && hover.pe === 'auto',
      `opacity=${hover.opacity} pointer-events=${hover.pe}`)
    check('按钮可被指针命中（没被图片盖住）', hover.hit === true)

    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hover.x, y: hover.y, button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hover.x, y: hover.y, button: 'left', clickCount: 1 })
    await sleep(3000)

    const after = await page.evalInPage(`(() => {
      const seg = document.querySelector('.para-text[data-para-id="' + ${JSON.stringify(sample.segId)} + '"]')
      return {
        pageImgs: seg ? seg.querySelectorAll('img').length : null,
        groups: seg ? seg.querySelectorAll('.md-figure-group').length : 0,
      }
    })()`)

    check('点一次 × 页面只少一张', after.pageImgs === before.pageImgs - 1,
      `${before.pageImgs} → ${after.pageImgs}`)
    check('删完仍有竖图时重新并排', after.pageImgs < 2 || after.groups >= 1, `${after.groups} 组`)

    // 服务端是否也恰好少一张：用页面同源 fetch 读最新结构
    const serverImgs = await page.evalInPage(`fetch('/api/text/${sample.textId}')
      .then(r => r.json())
      .then(j => {
        const segs = j.segments || j.paragraphs || []
        const s = segs.find(x => x.id === ${JSON.stringify(sample.segId)})
        const m = ((s && s.text) || '').match(/!\\[[^\\]]*\\]\\([^)]+\\)/g)
        return m ? m.length : -1
      })`)
    check('服务端同样只少一张（不是把整段覆盖成旧结构）', serverImgs === before.pageImgs - 1,
      `服务端 ${serverImgs} 张 / 段落原 ${before.pageImgs} 张`)

    // 复原
    const restored = await page.evalInPage(`fetch('/api/text/update-segment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textId: ${JSON.stringify(sample.textId)}, segmentId: ${JSON.stringify(sample.segId)}, text: ${JSON.stringify(sample.text)} }),
    }).then(r => r.status)`)
    check('样本段落已复原', restored === 200, `HTTP ${restored}`)
  } else {
    check('hover 后按钮可命中', false, '找不到样本段落')
  }
} catch (e) {
  console.error('\n脚本异常：', e?.message || e)
  check('脚本无异常', false)
} finally {
  if (page) await page.close()
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过${failed ? `，${failed} 项失败` : ''}`)
process.exit(failed ? 1 : 0)
