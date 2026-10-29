/**
 * 阅读页「段落配图」回归（真 Chrome + CDP）
 *
 * 这一块全是展示层的坑，接口和数据库永远是对的：图片 key 一直在库里，
 * 但用户看到的可能是「被裁掉一半的方块」「放大了糊成一片」「一高一矮撕出空洞」。
 * 所以断言必须落在**渲染出来的像素尺寸**上，不能只查 DOM 有没有 <img>。
 *
 * 覆盖：
 *   1  找到一篇有段落配图的文章，配图区渲染出来
 *   2  单图不裁切：显示比例 ≈ 原图比例（误差 < 2%）
 *   3  单图不放大：显示宽度 ≤ 原图宽度（放大必糊）
 *   4  单图不吃满屏：显示高度 ≤ 60vh + 容差
 *   5  多图列数：2~4 张 = 2 列，≥5 张 = 3 列
 *   6  多图同行等高（组内统一比例），高度差 ≤ 2px
 *   7  多图不裁切过度：容器比例 = 首图比例
 *   8  点图打开灯箱，计数「1 / N」正确
 *   9  灯箱右箭头切换到下一张
 *   10 Esc 关闭灯箱
 *   11 移动端（390px）：多图统一 1:1 方形格
 *   12 图片带 loading=lazy 与 decoding=async
 *   13 多图带 srcset 派生档位
 *   14 单图用固定派生档位（不能给单图 srcset，会把渲染尺寸按 density 缩小）
 *   15 已加载的配图都走 WebP 派生，不是原图直出
 *   16 灯箱加载原图（不带 ?w=）
 *
 * 用法：node server/scripts/verify-para-images.mjs [textId]
 *   不传 textId 时自动挑一篇配图最多的文章。
 * 需要服务在跑（npm run dev / npm start）。
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
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

/** 挑一篇有配图的文章（优先：既有单图段落又有多图段落） */
function pickText() {
  const db = new DatabaseSync('server/data/reader.db', { readOnly: true })
  const rows = db.prepare('SELECT id, segments FROM texts').all()
  let best = null
  for (const r of rows) {
    if (!r.segments) continue
    let arr
    try { arr = JSON.parse(r.segments) } catch { continue }
    const groups = arr.filter((p) => p?.images?.length).map((p) => p.images.length)
    if (!groups.length) continue
    const hasSingle = groups.some((n) => n === 1)
    const hasMulti = groups.some((n) => n >= 2)
    // 打分：同时具备单图与多图 > 段数多
    const score = (hasSingle && hasMulti ? 100 : 0) + groups.length
    if (!best || score > best.score) best = { id: r.id, score, groups, hasSingle, hasMulti }
  }
  db.close()
  return best
}

const target = process.argv[2]
const picked = target ? { id: target } : pickText()
if (!picked?.id) {
  console.error('库里没有带段落配图的文章，先往某一段插张图再跑')
  process.exit(1)
}
const TEXT_ID = picked.id
console.log(`目标文章：${TEXT_ID}${picked.groups ? `（配图区 ${picked.groups.length} 组：${picked.groups.join('/')} 张）` : ''}`)

const BASE = await resolveBase()
let page = null
try {
  page = await launchChrome({ profile: 'server/data/.tmp-e2e-pimg', base: BASE, token: TOKEN })

  // ── 桌面 1440×900 ──
  await page.goto(`${BASE}/read/${TEXT_ID}`)
  await waitFor(async () => (await page.evalInPage('document.querySelectorAll(".para-block").length')) > 0,
    { timeout: 30000, interval: 400, label: '正文渲染' })
  await waitFor(async () => (await page.evalInPage('document.querySelectorAll(".pim-cell").length')) > 0,
    { timeout: 15000, interval: 300, label: '配图渲染' })

  // 先把所有图滚出来触发 lazy 加载，否则视口外的 img 尺寸为 0
  await page.evalInPage(`(async () => {
    const el = document.querySelector('.reader-article-pane')
    el.style.scrollBehavior = 'auto'
    const total = el.scrollHeight
    for (let y = 0; y < total; y += 500) { el.scrollTop = y; await new Promise(r => setTimeout(r, 60)) }
    el.scrollTop = 0
    await new Promise(r => setTimeout(r, 800))
    return true
  })()`)

  const measure = () => page.evalInPage(`(() => {
    const groups = [...document.querySelectorAll('.pim')].map((fig) => {
      const cells = [...fig.querySelectorAll('.pim-cell')]
      const imgs = cells.map((c) => c.querySelector('img'))
      const grid = fig.querySelector('.pim-grid')
      return {
        n: cells.length,
        mini: fig.classList.contains('pim--single'),
        tier: ([...fig.classList].find((c) => /^pim--(sm|md|lg)$/.test(c)) || '').replace('pim--', ''),
        disp: grid ? getComputedStyle(grid).display : '',
        cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
        cells: cells.map((c, i) => {
          const cr = c.getBoundingClientRect()
          const im = imgs[i]
          const ir = im.getBoundingClientRect()
          return {
            w: Math.round(cr.width), h: Math.round(cr.height),
            iw: Math.round(ir.width), ih: Math.round(ir.height),
            nw: im.naturalWidth, nh: im.naturalHeight,
            lazy: im.getAttribute('loading'), dec: im.getAttribute('decoding'),
          }
        }),
      }
    })
    const pane = document.querySelector('.reader-article-pane')
    return { groups, vh: window.innerHeight, paneTop: pane ? pane.getBoundingClientRect().top : 0 }
  })()`)

  /** 把整篇文章滚一遍，逼 lazy 图全部落地（不滚动时视口外的 img 尺寸是 0） */
  const warmup = () => page.evalInPage(`(async () => {
    const el = document.querySelector('.reader-article-pane')
    el.style.scrollBehavior = 'auto'
    const total = el.scrollHeight
    for (let y = 0; y < total; y += 500) { el.scrollTop = y; await new Promise(r => setTimeout(r, 60)) }
    el.scrollTop = 0
    await new Promise(r => setTimeout(r, 800))
    return true
  })()`)

  // ── 默认档「小图」：段落里只放缩略图，点开才看大图 ──
  const smInfo = await measure()
  const smGroups = smInfo.groups || []
  check('默认档位是小图',
    smGroups.length > 0 && smGroups.every((g) => g.tier === 'sm'),
    smGroups.map((g) => g.tier || '?').join('/') || '没有配图')

  const smCells = smGroups.flatMap((g) => g.cells.map((c) => ({ ...c, n: g.n })))
  const tooBig = smCells.filter((c) => (c.n === 1 ? c.iw > 202 || c.ih > 202 : c.iw > 133 || c.ih > 133))
  check('小图是真缩略图（多图 ≤132px，单图 ≤200px）', smCells.length > 0 && tooBig.length === 0,
    `最大 ${Math.max(...smCells.map((c) => Math.max(c.iw, c.ih)))}px / ${smCells.length} 张`)

  // 缩略图也要保比例：压成方框会裁掉图的一半，等于把"粗糙"换个尺寸重演
  const smCrop = smCells.filter((c) => {
    if (!c.nw || !c.nh || !c.iw || !c.ih) return false
    const natR = c.nw / c.nh
    return Math.abs(natR - c.iw / c.ih) / natR > 0.03
  })
  check('小图不裁切（按原比例缩进方框）', smCells.length > 0 && smCrop.length === 0,
    `${smCells.length} 张里 ${smCrop.length} 张失真`)

  const smFlex = smGroups.filter((g) => g.n >= 2)
  check('多图小图横向排开（flex 缩略图条）', smFlex.length > 0 && smFlex.every((g) => g.disp === 'flex'),
    smFlex.map((g) => `${g.n}张/${g.disp}`).join(' ') || '没有多图样本')

  // 切到「标准」再测原有版面规则：列数/等高/比例只对 md、lg 有意义
  await page.evalInPage(`(() => {
    document.querySelectorAll('.pim').forEach((f) => {
      const b = [...f.querySelectorAll('.pim-size')].find((x) => x.textContent.trim() === '标准')
      b?.click()
    })
    return true
  })()`)
  await sleep(700)
  await warmup()

  const measured = await measure()

  const groups = measured.groups || []
  check('配图区渲染出来', groups.length > 0, `${groups.length} 组`)

  // ── 2~4 单图断言 ──
  const singles = groups.filter((g) => g.n === 1 && g.cells[0].nw > 0)
  if (singles.length) {
    const bad = singles.filter((g) => {
      const c = g.cells[0]
      const natR = c.nw / c.nh
      const disR = c.iw / c.ih
      return Math.abs(natR - disR) / natR > 0.02
    })
    check('单图不裁切（显示比例≈原图比例）', bad.length === 0, `${singles.length} 张里 ${bad.length} 张比例失真`)

    const upscaled = singles.filter((g) => g.cells[0].iw > g.cells[0].nw + 2)
    check('单图不放大（显示宽 ≤ 原图宽）', upscaled.length === 0,
      upscaled.map((g) => `${g.cells[0].iw}>${g.cells[0].nw}`).join(','))

    const tooTall = singles.filter((g) => g.cells[0].ih > measured.vh * 0.6 + 12)
    check('单图不吃满屏（高 ≤ 60vh）', tooTall.length === 0,
      tooTall.map((g) => `${g.cells[0].ih}px > ${Math.round(measured.vh * 0.6)}`).join(','))
  } else {
    check('单图不裁切（显示比例≈原图比例）', false, '没有可测的单图样本')
  }

  // ── 多图断言 ──
  const multis = groups.filter((g) => g.n >= 2 && g.cells.every((c) => c.nw > 0))
  if (multis.length) {
    const wrongCols = multis.filter((g) => (g.n <= 4 ? g.cols !== 2 : g.cols < 3))
    check('多图列数（2~4 张=2 列，≥5 张≥3 列）', wrongCols.length === 0,
      multis.map((g) => `${g.n}张/${g.cols}列`).join(' '))

    const uneven = multis.filter((g) => {
      const hs = g.cells.map((c) => c.h)
      return Math.max(...hs) - Math.min(...hs) > 2
    })
    check('多图同行等高（组内统一比例）', uneven.length === 0,
      uneven.map((g) => g.cells.map((c) => c.h).join('/')).join(' '))

    const ratioOff = multis.filter((g) => {
      const first = g.cells[0]
      const natR = first.nw / first.nh
      const disR = first.w / first.h
      return Math.abs(natR - disR) / natR > 0.03
    })
    check('多图容器比例=首图比例（不过度裁切）', ratioOff.length === 0,
      ratioOff.map((g) => `${Math.round(g.cells[0].w)}x${Math.round(g.cells[0].h)}`).join(' '))
  } else {
    check('多图列数（2~4 张=2 列，≥5 张≥3 列）', false, '没有可测的多图样本')
  }

  // ── 懒加载属性 ──
  const allCells = groups.flatMap((g) => g.cells)
  const noLazy = allCells.filter((c) => c.lazy !== 'lazy' || c.dec !== 'async')
  check('图片 lazy + async 解码', noLazy.length === 0, `${allCells.length} 张里 ${noLazy.length} 张缺属性`)

  // ── 派生缩略图（?w=800 / ?w=1600）──
  // 这一层极易被"顺手改回原图"破坏：功能完全正常，只是每张图从 60KB 变回 2.9MB。
  // 单图与多图的取法不同：多图用 srcset（格子定宽，内在尺寸不参与布局），
  // 单图必须用固定 ?w=1600 —— 给单图加 w 描述符会让浏览器按 density 缩小渲染尺寸。
  const srcInfo = await page.evalInPage(`(() => {
    const pick = (sel) => [...document.querySelectorAll(sel)].map((i) => ({
      srcset: i.getAttribute('srcset') || '',
      src: i.getAttribute('src') || '',
      cur: i.currentSrc || '',
    }))
    return { multi: pick('.pim:not(.pim--single) .pim-cell img'), single: pick('.pim--single .pim-cell img') }
  })()`)
  const multi = srcInfo?.multi || []
  const single = srcInfo?.single || []
  const multiNoSrcset = multi.filter((i) => !i.srcset.includes('?w='))
  check('多图带 srcset 派生档位', multi.length > 0 && multiNoSrcset.length === 0,
    `${multi.length} 张里 ${multiNoSrcset.length} 张没走派生`)
  const singleFixed = single.filter((i) => i.src.includes('?w=') && !i.srcset)
  check('单图用固定派生档位（且无 srcset）', single.length > 0 && singleFixed.length === single.length,
    `${single.length} 张里 ${singleFixed.length} 张合规`)

  const loaded = [...multi, ...single].filter((i) => i.cur)
  const origLoaded = loaded.filter((i) => !i.cur.includes('?w='))
  check('已加载的配图都走 WebP 派生', loaded.length > 0 && origLoaded.length === 0,
    `${loaded.length} 张已加载中 ${origLoaded.length} 张是原图`)

  // ── 灯箱 ──
  const multiIdx = groups.findIndex((g) => g.n >= 2)
  if (multiIdx >= 0) {
    await page.evalInPage(`(() => {
      const el = document.querySelector('.reader-article-pane')
      const fig = document.querySelectorAll('.pim')[${multiIdx}]
      el.style.scrollBehavior = 'auto'
      el.scrollTop += fig.getBoundingClientRect().top - 80
      return true
    })()`)
    await sleep(600)
    await page.evalInPage(`document.querySelectorAll('.pim')[${multiIdx}].querySelectorAll('.pim-cell')[0].click()`)
    await sleep(500)
    const lb1 = await page.evalInPage(`(() => {
      const box = document.querySelector('.lb')
      const big = document.querySelector('.lb-img')
      if (!box || !big) return { open: false }
      const cs = getComputedStyle(box)
      return {
        open: true, bg: cs.backgroundColor, pe: cs.pointerEvents,
        chrome: document.querySelectorAll('.lb-nav, .lb-hud, .lb-count, .lb-zoom').length,
        src: big.getAttribute('src') || '',
      }
    })()`)
    check('点图浮出贴图浮层', lb1.open === true)
    check('浮层无黑色遮罩、不吃页面点击',
      lb1.bg === 'rgba(0, 0, 0, 0)' && lb1.pe === 'none', `${lb1.bg} / ${lb1.pe}`)
    check('没有翻页、没有底部工具栏', lb1.chrome === 0, `${lb1.chrome} 个残留控件`)

    // 贴图必须用原图：缩略图在放大后会糊，"看细节"是这个入口的唯一理由
    check('贴图加载原图（不带 ?w=）', !!lb1.src && !lb1.src.includes('?w='), lb1.src.split('/').pop())

    // 用页面内 dispatch 而不是 CDP Input：headless 下焦点不在文档时按键会被丢掉，
    // 那样断言的是「CDP 有没有送到」而不是「组件有没有监听 Esc」。
    await page.evalInPage(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(500)
    const closed = await page.evalInPage(`!document.querySelector('.lb')`)
    check('Esc 关闭灯箱', closed === true)
  } else {
    check('点图打开灯箱', false, '没有多图样本')
  }

  // ── 移动端 390px ──
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await page.goto(`${BASE}/read/${TEXT_ID}`)
  await waitFor(async () => (await page.evalInPage('document.querySelectorAll(".pim-cell").length')) > 0,
    { timeout: 30000, interval: 400, label: '移动端配图渲染' })
  await page.evalInPage(`(async () => {
    const el = document.querySelector('.reader-article-pane')
    el.style.scrollBehavior = 'auto'
    const total = el.scrollHeight
    for (let y = 0; y < total; y += 700) { el.scrollTop = y; await new Promise(r => setTimeout(r, 50)) }
    el.scrollTop = 0
    await new Promise(r => setTimeout(r, 600))
    return true
  })()`)

  // 手机默认同样是缩略图，且要能一行贴下 3 张（108px 档）
  const mobileSm = await page.evalInPage(`(() => {
    const cells = [...document.querySelectorAll('.pim:not(.pim--single) .pim-cell')]
    const sizes = cells.map((c) => { const r = c.querySelector('img').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })
    const maxW = sizes.length ? Math.max(...sizes.map((s) => s.w)) : 0
    const figs = [...document.querySelectorAll('.pim:not(.pim--single)')]
    const perRow = figs.map((f) => {
      const tops = [...f.querySelectorAll('.pim-cell')].map((c) => Math.round(c.getBoundingClientRect().top))
      return tops.filter((t) => t === tops[0]).length
    })
    return { n: cells.length, maxW, perRow, counts: figs.map((f) => f.querySelectorAll('.pim-cell').length) }
  })()`)
  check('手机缩略图更小（≤108px）', mobileSm.n > 0 && mobileSm.maxW <= 109, `最大 ${mobileSm.maxW}px`)
  // 390px 手机一行该排下 3 张（108×3 + 间距 ≈ 336）；≤3 张的组若分行就是没排下
  const wrapBad = (mobileSm.counts || []).filter((c, i) => c <= 3 && mobileSm.perRow[i] !== c)
  check('手机一行排下 3 张缩略图（≤3 张时分行即不合格）',
    (mobileSm.counts || []).length > 0 && wrapBad.length === 0,
    `每组 ${(mobileSm.counts || []).join('/')} 张，首行 ${(mobileSm.perRow || []).join('/')}`)

  // 切「标准」再验 1:1 网格（缩略图不是网格，不适用这条）
  await page.evalInPage(`(() => {
    document.querySelectorAll('.pim').forEach((f) => {
      const b = [...f.querySelectorAll('.pim-size')].find((x) => x.textContent.trim() === '标准')
      b?.click()
    })
    return true
  })()`)
  await sleep(900)
  const mobile = await page.evalInPage(`(() => {
    const figs = [...document.querySelectorAll('.pim:not(.pim--single)')]
    return figs.map((fig) => [...fig.querySelectorAll('.pim-cell')].map((c) => {
      const r = c.getBoundingClientRect()
      return Math.round(r.width) + 'x' + Math.round(r.height)
    }))
  })()`)
  const notSquare = (mobile || []).filter((cells) => cells.some((s) => {
    const [w, h] = s.split('x').map(Number)
    return Math.abs(w - h) > 2
  }))
  check('移动端多图统一 1:1', (mobile || []).length > 0 && notSquare.length === 0,
    notSquare.map((c) => c.join(',')).join(' '))
} catch (e) {
  console.error('\n脚本异常：', e?.message || e)
  check('脚本无异常', false)
} finally {
  if (page) await page.close()
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过${failed ? `，${failed} 项失败` : ''}`)
process.exit(failed ? 1 : 0)
