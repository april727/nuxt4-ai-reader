/**
 * 试卷页手机布局回归（真 Chrome + CDP，手机视口）。
 *
 *   node server/scripts/verify-sheet-mobile.mjs
 *
 * 起因：手机上顶栏所有控件挤在一行，总宽约 520px 超过 412px 视口，于是
 *   ① 页码块被挤到标题上，叠成「第五单页」这种看起来像乱码的东西；
 *   ② 更隐蔽：溢出让 documentElement.scrollWidth 变成 435，画布按 435 算 fitWidth，
 *      试卷右侧那列题号被裁掉 —— 只盯着顶栏修，根本发现不了图片被裁。
 * 所以这里每一条都断言几何量，不看「元素存在」。
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

/** 手机视口：不仅是宽度，还要真的把 (hover:none) 与 maxTouchPoints 一起模拟上 */
async function setPhone(b, w, h) {
  await b.send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 2, mobile: true,
  })
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
}

/** 页面内的几何探针：统一在这里取，避免各处 selector 漂移 */
const PROBE = `(() => {
  const r = (s) => {
    const el = document.querySelector(s)
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1),
             right: +b.right.toFixed(1), bottom: +b.bottom.toFixed(1) }
  }
  return {
    win: window.innerWidth,
    docScroll: document.documentElement.scrollWidth,
    topbar: r('.sheet-topbar'),
    title: r('.tb-title'),
    center: r('.tb-center'),
    row2: r('.tb-right'),
    vp: r('.sheet-vp'),
    img: r('.sheet-img'),
    hint: r('.sheet-hint'),
    zoom: r('.sheet-zoombar'),
    hintText: (document.querySelector('.sheet-hint') || {}).textContent?.trim() || '',
    toolsOut: [...document.querySelectorAll('.tb-right button, .tb-right a')]
      .map((el) => +el.getBoundingClientRect().right.toFixed(1))
      .filter((x) => x > window.innerWidth - 1).length,
    /* 顶栏收口件：手机靠这些替代文字按钮，桌面必须反过来看不见 */
    more: r('.more-btn'),
    moreMenu: r('.more-menu'),
    kindSelect: r('.kind-select'),
    aiBtn: r('.ai-btn'),
    toolIco: r('.tool-ico'),
    toolTxt: r('.tool-txt'),
    toolMinH: Math.min(
      ...[...document.querySelectorAll('.tool-group .tool')]
        .map((el) => el.getBoundingClientRect().height)
        .concat([999]),
    ),
    menuItems: [...document.querySelectorAll('.more-menu .more-item')]
      .map((el) => el.textContent.trim()),
  }
})()`

const rows = await q(
  "SELECT id, title FROM texts WHERE contentKind='sheet' AND deletedAt IS NULL ORDER BY createdAt DESC LIMIT 1",
)
if (!rows.length) {
  console.log('跳过：库里没有试卷样本')
  process.exit(0)
}
const sheetId = rows[0].id
console.log(`样本试卷：${rows[0].title}（${sheetId}）\n`)

const base = await resolveBase()
const browser = await launchChrome({ port: 9455, profile: 'server/data/.tmp-sheet-mobile', base, token })

try {
  // ── 手机 390×844 ──
  await setPhone(browser, 390, 844)
  await browser.goto(`${base}/sheet/${sheetId}`)
  await waitFor(async () => (await browser.evalInPage(PROBE)).img !== null,
    { timeout: 30000, interval: 300, label: '试卷渲染' })
  await sleep(900)

  const m = await browser.evalInPage(PROBE)

  check('无横向溢出（文档宽度 = 视口宽度）', m.docScroll === m.win, `doc ${m.docScroll} / win ${m.win}`)
  check('顶栏折成两行', !!m.topbar && m.topbar.h > 60 && m.row2 && m.row2.y > m.title.y,
    `顶栏高 ${m.topbar?.h}，工具行 y=${m.row2?.y} / 标题 y=${m.title?.y}`)
  check('标题与页码不重叠', m.title && m.center && m.title.right <= m.center.x + 0.5,
    `标题右 ${m.title?.right} / 页码左 ${m.center?.x}`)
  check('工具按钮全在屏内', m.toolsOut === 0, `出屏 ${m.toolsOut} 个`)
  check('试卷按视口宽铺满（右侧不裁）', Math.abs(m.img.w - m.vp.w) <= 1,
    `图 ${m.img.w} / 视口 ${m.vp.w}`)
  check('底部提示与缩放条不重叠', m.hint.right <= m.zoom.x + 0.5,
    `提示右 ${m.hint.right} / 缩放条左 ${m.zoom.x}`)
  check('触屏提示不含「滚轮」', !m.hintText.includes('滚轮'), JSON.stringify(m.hintText))

  // ── 顶栏收口：手机把主功能收进「更多」、工具改图标、类型改下拉 ──
  check('手机出现「更多」按钮且在屏内', m.more && m.more.w > 0 && m.more.right <= m.win,
    `x ${m.more?.x} w ${m.more?.w} / 视口 ${m.win}`)
  check('手机不收桌面那套 AI 切题按钮（已进菜单）', !m.aiBtn || m.aiBtn.w === 0, `宽 ${m.aiBtn?.w}`)
  check('手机工具按钮只剩图标', m.toolIco && m.toolIco.w > 0 && (!m.toolTxt || m.toolTxt.w === 0),
    `图标 ${m.toolIco?.w} / 文字 ${m.toolTxt?.w}`)
  check('手机工具触摸目标高度 ≥ 26px', m.toolMinH >= 26, `最小 ${m.toolMinH?.toFixed(1)}px`)
  check('手机类型选择为下拉', m.kindSelect && m.kindSelect.w > 0, `宽 ${m.kindSelect?.w}`)

  // 菜单能开、不出屏、含主功能
  await browser.evalInPage(`document.querySelector('.more-btn').click(); true`)
  await sleep(450)
  const mn = await browser.evalInPage(PROBE)
  check('「更多」菜单可展开', mn.moreMenu && mn.moreMenu.h > 40, `高 ${mn.moreMenu?.h}`)
  check('菜单不出屏', mn.moreMenu && mn.moreMenu.right <= mn.win + 0.5,
    `菜单右 ${mn.moreMenu?.right} / 视口 ${mn.win}`)
  check('菜单含 AI 切题与错题本',
    mn.menuItems.some((t) => t.includes('AI 切题')) && mn.menuItems.some((t) => t.includes('错题本')),
    JSON.stringify(mn.menuItems))

  // 点空白处收起（菜单是浮层，不收会盖住画布）
  await browser.evalInPage(`document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })); true`)
  await sleep(350)
  const mc = await browser.evalInPage(PROBE)
  check('点空白处菜单收起', !mc.moreMenu || mc.moreMenu.h === 0, `高 ${mc.moreMenu?.h}`)

  // ── 320：老机型 ──
  await setPhone(browser, 320, 720)
  await sleep(700)
  const s320 = await browser.evalInPage(PROBE)
  check('320 宽仍无横向溢出', s320.docScroll === s320.win, `doc ${s320.docScroll}`)
  check('320 宽工具按钮不出屏', s320.toolsOut === 0, `出屏 ${s320.toolsOut} 个`)
  check('320 宽试卷仍铺满视口', Math.abs(s320.img.w - s320.vp.w) <= 1, `图 ${s320.img.w} / 视口 ${s320.vp.w}`)

  // ── 桌面 1280：不能被手机规则带坏 ──
  await browser.send('Emulation.clearDeviceMetricsOverride')
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await sleep(600)
  const d = await browser.evalInPage(PROBE)
  check('桌面顶栏仍是单行', d.topbar.h <= 56, `顶栏高 ${d.topbar.h}`)
  check('桌面不出现「更多」按钮', !d.more || d.more.w === 0, `宽 ${d.more?.w}`)
  check('桌面 AI 切题仍平铺可见', d.aiBtn && d.aiBtn.w > 0, `宽 ${d.aiBtn?.w}`)
  check('桌面工具显示文字而非图标', d.toolTxt && d.toolTxt.w > 0 && (!d.toolIco || d.toolIco.w === 0),
    `文字 ${d.toolTxt?.w} / 图标 ${d.toolIco?.w}`)
  check('桌面类型是彩色按钮组而非下拉', !d.kindSelect || d.kindSelect.w === 0, `下拉宽 ${d.kindSelect?.w}`)
  check('桌面提示回到鼠标文案', d.hintText.includes('滚轮'), JSON.stringify(d.hintText))
  check('桌面画布未被挤出屏', d.docScroll === d.win && d.vp.w > 300, `画布宽 ${d.vp.w}`)
} catch (e) {
  check('执行异常', false, String(e?.message || e))
} finally {
  await browser.close()
}

console.log(`\n合计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`)
process.exit(fail ? 1 : 0)
