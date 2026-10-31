/**
 * 试卷连续画布回归（真 Chrome + CDP，手机视口）。
 *
 *   node server/scripts/verify-sheet-board.mjs
 *
 * 这一版把「一页一张图 + 翻页换图」换成了「一个变换空间里 N 页同屏」。
 * 这类改动最容易出的错不是"画不出来"，而是下面四种，全部只在数字上露馅：
 *   ① 页铺不满或铺过头（差 1~2px 就有一列题号被裁）；
 *   ② 缩小时图片仍拉原图（1722×2400×4B ≈ 16.5MB/页，缩略态全开就是 165MB）；
 *   ③ 滚动后页码不跟着变（顶栏写着 1/4，人已经看到第 3 页）；
 *   ④ 在 A 页画框落到了 B 页（跨页时框必须归起点页）。
 *
 * 需要 dev 服务在跑（默认 http://[::1]:3000）。
 */
import { launchChrome, resolveBase, sleep, waitFor } from './lib/cdp.mjs'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { q } from './_testdb.mjs'

const env = readFileSync('.env', 'utf8').split(/\r?\n/).reduce((a, l) => {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) a[m[1]] = m[2].replace(/^["']|["']$/g, '')
  return a
}, {})
const token = createHash('sha256').update(env.SITE_PASSWORD || '').digest('hex')

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? '  ' + detail : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`) }
}

async function setPhone(b, w, h) {
  await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true })
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
}

const PROBE = `(() => {
  const box = (el) => {
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1),
             bottom: +b.bottom.toFixed(1), right: +b.right.toFixed(1) }
  }
  const pages = [...document.querySelectorAll('.sheet-page')]
  const vp = document.querySelector('.sheet-vp')
  const vis = pages.filter((p) => {
    const b = p.getBoundingClientRect()
    const v = vp.getBoundingClientRect()
    return b.bottom > v.top && b.top < v.bottom
  })
  const marks = [...document.querySelectorAll('.page-no')]
  return {
    win: window.innerWidth,
    docScroll: document.documentElement.scrollWidth,
    vp: box(vp),
    pageCount: pages.length,
    visCount: vis.length,
    firstPage: box(pages[0]),
    pageNo: (document.querySelector('.tb-page') || {}).textContent?.trim() || '',
    zoom: (document.querySelector('.zoom-val') || {}).textContent?.trim() || '',
    zoomPct: parseFloat((document.querySelector('.zoom-val') || {}).textContent || '0'),
    tiers: [...document.querySelectorAll('.sheet-img')].map((i) => i.getAttribute('data-tier')),
    markCount: marks.length,
    markH: marks.length ? +marks[0].getBoundingClientRect().height.toFixed(1) : 0,
    annoCount: document.querySelectorAll('.sheet-anno:not(.draft)').length,
    annoPageIdx: (() => {
      const a = [...document.querySelectorAll('.sheet-anno:not(.draft)')].pop()
      if (!a) return -1
      return pages.indexOf(a.closest('.sheet-page'))
    })(),
  }
})()`

const rows = await q(
  "SELECT id, title, annotations FROM texts WHERE contentKind='sheet' AND deletedAt IS NULL ORDER BY createdAt DESC LIMIT 1",
)
if (!rows.length) {
  console.log('跳过：库里没有试卷样本')
  process.exit(0)
}
const sheetId = rows[0].id
const annotationsBefore = rows[0].annotations || '[]'
console.log(`样本试卷：${rows[0].title}（${sheetId}）\n`)

const base = await resolveBase()
const browser = await launchChrome({ port: 9457, profile: 'server/data/.tmp-sheet-board', base, token })

/** 在视口里点一下（合成指针事件，和真实手势走同一条 onDown/onUp） */
async function tap(x, y, id = 21) {
  await browser.evalInPage(`(() => {
    const vp = document.querySelector('.sheet-vp')
    const P = (t) => new PointerEvent(t, { pointerId: ${id}, clientX: ${x}, clientY: ${y}, bubbles: true, button: 0, isPrimary: true })
    vp.dispatchEvent(P('pointerdown'))
    vp.dispatchEvent(P('pointerup'))
    return true
  })()`)
}

/** 在视口里拖一个框 */
async function dragBox(x0, y0, x1, y1, id = 23) {
  await browser.evalInPage(`(async () => {
    const vp = document.querySelector('.sheet-vp')
    const P = (t, x, y) => new PointerEvent(t, { pointerId: ${id}, clientX: x, clientY: y, bubbles: true, button: 0, isPrimary: true })
    vp.dispatchEvent(P('pointerdown', ${x0}, ${y0}))
    for (let i = 1; i <= 5; i++) {
      vp.dispatchEvent(P('pointermove', ${x0} + (${x1} - ${x0}) * i / 5, ${y0} + (${y1} - ${y0}) * i / 5))
      await new Promise((r) => setTimeout(r, 30))
    }
    vp.dispatchEvent(P('pointerup', ${x1}, ${y1}))
    return true
  })()`)
}

try {
  await setPhone(browser, 390, 844)
  await browser.goto(`${base}/sheet/${sheetId}`)
  await waitFor(async () => (await browser.evalInPage(PROBE)).pageCount > 0,
    { timeout: 30000, interval: 300, label: '试卷渲染' })
  await sleep(1000)

  const init = await browser.evalInPage(PROBE)

  // ── 1. 多页同屏：DOM 里是全部页，不是"当前页 + 占位" ──
  check('画布内是全部页，不是单页', init.pageCount >= 2, `${init.pageCount} 页`)
  check('初始视图第 1 页铺满视口宽', Math.abs(init.firstPage.w - init.vp.w) <= 1.5,
    `页 ${init.firstPage.w} / 视口 ${init.vp.w}`)
  check('初始页码 1/4', init.pageNo.startsWith('1'), JSON.stringify(init.pageNo))
  check('阅读态不显示页码水印（不挡字）', init.markCount === 0, `${init.markCount} 个水印`)
  check('无横向溢出', init.docScroll === init.win, `doc ${init.docScroll} / win ${init.win}`)

  // ── 2. 图片分档：铺满时不能用 320 那种糊图 ──
  const initTier = Number(init.tiers[0])
  check('铺满时第 1 页取高档位图', initTier >= 800, `档位 ${init.tiers[0]}`)

  // ── 3. 滚轮向下 → 视口进到下一页，页码跟着变 ──
  await browser.evalInPage(`(() => {
    document.querySelector('.sheet-vp').dispatchEvent(new WheelEvent('wheel', { deltaY: 420, bubbles: true, cancelable: true }))
    return true
  })()`)
  await sleep(600)
  const scrolled = await browser.evalInPage(PROBE)
  // 不断言"第几页"：一个滚动量对应几页取决于缩放，只断言"前进了且没跳飞"
  check('滚轮后页码跟着视口走',
    Number(scrolled.pageNo.split('/')[0]) > Number(init.pageNo.split('/')[0]),
    `${init.pageNo} → ${scrolled.pageNo}`)

  // ── 4. 总览：全部页塞进一屏 ──
  await browser.evalInPage(`document.querySelector('.zoom-val').click(); true`)
  await sleep(800)
  const all = await browser.evalInPage(PROBE)
  check('总览把全部页放进一屏', all.visCount === all.pageCount, `可见 ${all.visCount} / 共 ${all.pageCount}`)
  check('总览缩放足够小', all.zoomPct <= 15, `${all.zoom}`)
  check('缩略态出现页码水印', all.markCount === all.pageCount, `${all.markCount} 个`)
  check('水印在屏幕上可读（≥10px 高）', all.markH >= 10, `高 ${all.markH}px`)
  check('缩略态图片降到低档位（省解码内存）',
    all.tiers.every((t) => Number(t) <= 480), all.tiers.join(','))

  // ── 5. 总览里点第 3 页 → 进那一页 ──
  const p3 = await browser.evalInPage(`(() => {
    const p = document.querySelectorAll('.sheet-page')[2].getBoundingClientRect()
    return { x: p.x + p.width / 2, y: p.y + Math.min(40, p.height / 3) }
  })()`)
  await tap(p3.x, p3.y)
  await sleep(900)
  const atP3 = await browser.evalInPage(PROBE)
  check('总览里点某页直接进那一页', atP3.pageNo.startsWith('3'), JSON.stringify(atP3.pageNo))
  check('进页后放大到铺满视口宽', Math.abs(atP3.firstPage.w - atP3.vp.w) <= 1.5 || atP3.zoomPct >= 20,
    `缩放 ${atP3.zoom}`)

  // ── 6. 缩到总览后切「框选」→ 自动放到可操作比例 ──
  await browser.evalInPage(`document.querySelector('.zoom-val').click(); true`)
  await sleep(700)
  const beforeBox = await browser.evalInPage(PROBE)
  await browser.evalInPage(`document.querySelectorAll('.tb-right .tool')[1].click(); true`)
  await sleep(800)
  const afterBox = await browser.evalInPage(PROBE)
  check('切到框选会自动放大到可操作比例', afterBox.zoomPct > beforeBox.zoomPct * 2,
    `${beforeBox.zoom} → ${afterBox.zoom}`)

  // ── 7. 在别的页上画框，必须落在那一页 ──
  const vpRect = afterBox.vp
  const p2Box = await browser.evalInPage(`(() => {
    const pages = [...document.querySelectorAll('.sheet-page')]
    const p = pages[1].getBoundingClientRect()
    const v = document.querySelector('.sheet-vp').getBoundingClientRect()
    return { top: p.top, bottom: p.bottom, vt: v.top, vb: v.bottom, left: p.left, right: p.right }
  })()`)
  // 先把视口滚到第 2 页（点一下页头）
  await browser.evalInPage(`document.querySelectorAll('.tb-right .tool')[0].click(); true`)
  await sleep(400)
  await tap(vpRect.x + vpRect.w / 2, Math.max(vpRect.y + 20, p2Box.top + 30))
  await sleep(800)
  await browser.evalInPage(`document.querySelectorAll('.tb-right .tool')[1].click(); true`)
  await sleep(500)

  const annoBefore = await browser.evalInPage(PROBE)
  await dragBox(vpRect.x + 60, vpRect.y + 200, vpRect.x + 300, vpRect.y + 340)
  await sleep(1200)
  const annoAfter = await browser.evalInPage(PROBE)

  check('框选建出一条标注', annoAfter.annoCount === annoBefore.annoCount + 1,
    `${annoBefore.annoCount} → ${annoAfter.annoCount}`)
  check('标注挂在起点所在的那一页（不是第 1 页）', annoAfter.annoPageIdx >= 1,
    `落在页索引 ${annoAfter.annoPageIdx}`)

  const saved = (await q('SELECT annotations FROM texts WHERE id=?', [sheetId]))[0]
  const arr = JSON.parse(saved?.annotations || '[]')
  const pgRow = (await q('SELECT segments FROM texts WHERE id=?', [sheetId]))[0]
  const pages = JSON.parse(pgRow?.segments || '[]')
  const lastAnno = arr[arr.length - 1]
  check('落库的 pageId 与画框的页一致',
    !!lastAnno && lastAnno.pageId === pages[annoAfter.annoPageIdx]?.id,
    `${lastAnno?.pageId} vs ${pages[annoAfter.annoPageIdx]?.id}`)

  // ── 8. 桌面：不该出现水印，画布仍铺满 ──
  await browser.send('Emulation.clearDeviceMetricsOverride')
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await sleep(800)
  const desk = await browser.evalInPage(PROBE)
  check('桌面阅读态也不显示水印', desk.markCount === 0, `${desk.markCount} 个`)
  check('桌面画布未被挤出屏', desk.docScroll === desk.win, `doc ${desk.docScroll} / win ${desk.win}`)
} catch (e) {
  check('执行异常', false, String(e?.message || e))
} finally {
  // 只复原 annotations 一列，别碰 pages / covers
  await q('UPDATE texts SET annotations=? WHERE id=?', [annotationsBefore, sheetId]).catch(() => {})
  await browser.close()
}

console.log(`\n合计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`)
process.exit(fail ? 1 : 0)
