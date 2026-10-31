/**
 * 试卷判分回归（真 Chrome + CDP）。
 *
 *   node server/scripts/verify-sheet-grade.mjs
 *
 * 判分是「第二次点击才看得见结果」的功能，光看接口 200 说明不了什么：
 * 角标在 transform: scale() 的容器里，字号靠反向补偿，很容易算错成看不见的 0.5px；
 * 总分又同时出现在顶栏、侧栏、浮条三处，任一处漏算都会让用户觉得「判了没反应」。
 * 所以这里每条都断言 DOM 里的实际数值，不看接口返回。
 *
 * 数据会临时改（加一个测试框、写判分），结束时按原样复原。
 */
import { launchChrome, resolveBase, sleep, waitFor } from './lib/cdp.mjs'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { q, qRun } from './_testdb.mjs'

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

const rows = await q(
  "SELECT id, title, annotations, grading FROM texts WHERE contentKind='sheet' AND deletedAt IS NULL ORDER BY createdAt DESC LIMIT 1",
)
if (!rows.length) {
  console.log('跳过：库里没有试卷样本')
  process.exit(0)
}
const sheetId = rows[0].id
const origAnno = rows[0].annotations || '[]'
const origGrading = rows[0].grading || '{}'
let annoList = []
try { annoList = JSON.parse(origAnno) } catch { annoList = [] }
const pages = await q('SELECT segments FROM texts WHERE id=?', [sheetId])
let pageList = []
try { pageList = JSON.parse(pages[0]?.segments || '[]') } catch { pageList = [] }

console.log(`样本试卷：${rows[0].title}（${sheetId}）`)
console.log(`原标注 ${annoList.length} 条，页面 ${pageList.length} 页\n`)

if (!pageList.length) {
  console.log('跳过：这份试卷没有页面')
  process.exit(0)
}

const TEST_BOX_ID = 'an_verify_grade'
const page0 = pageList[0].id
// 没有可判的框就临时加一个；有就复用第一个，避免污染版面
const useTemp = annoList.length === 0
const annoForTest = useTemp
  ? { id: TEST_BOX_ID, pageId: page0, kind: 'q', bbox: { x: 0.1, y: 0.1, w: 0.3, h: 0.12 }, note: '判分回归临时框', createdAt: new Date().toISOString() }
  : annoList[0]

const base = await resolveBase(process.env.TEST_BASE)
const browser = await launchChrome({ port: 9458, profile: 'server/data/.tmp-sheet-grade', base, token })

/** 页面内探针：一次取全，避免多次 eval 之间状态漂移 */
const PROBE = `(() => {
  const t = (s) => { const el = document.querySelector(s); return el ? el.textContent.trim() : null }
  const r = (s) => {
    const el = document.querySelector(s)
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { w: +b.width.toFixed(1), h: +b.height.toFixed(1), x: +b.x.toFixed(1), right: +b.right.toFixed(1) }
  }
  const badge = document.querySelector('.anno-grade')
  return {
    win: window.innerWidth,
    annoCount: document.querySelectorAll('.sheet-anno:not(.draft)').length,
    selected: document.querySelectorAll('.sheet-anno.active').length,
    gradeBtns: document.querySelectorAll('.grade-v').length,
    dock: r('.grade-dock'),
    dockBtns: document.querySelectorAll('.gd-v').length,
    panel: r('.reader-panel'),
    badge: badge ? { text: badge.textContent.trim(), ...r('.anno-grade') } : null,
    sum: t('.sp-grade-score'),
    rate: t('.sp-grade-rate'),
    topScore: t('.tb-score'),
    itemScore: t('.item-score'),
    clearBtn: !!document.querySelector('.sp-grade-clear'),
    maxInput: (document.querySelector('.gn input') || {}).value ?? null,
    gotInput: (document.querySelectorAll('.gn input')[1] || {}).value ?? null,
    activeVerdict: (document.querySelector('.grade-v.on') || {}).textContent?.trim() || null,
  }
})()`

const api = (path, body) => `fetch(${JSON.stringify(path)}, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(${JSON.stringify(body)}),
}).then(r => r.json()).then(j => JSON.stringify(j)).catch(e => 'ERR:' + e.message)`

/** 侧栏/画布上点第 n 个判定按钮（0 对 / 1 半对 / 2 错 / 3 未做） */
const clickVerdict = (n) => `(() => {
  const b = document.querySelectorAll('.grade-v')[${n}]
  if (!b) return false
  b.click(); return true
})()`

try {
  // ── 准备：清空判分，确保从零开始 ──
  await browser.goto(`${base}/sheet/${sheetId}`)
  await waitFor(async () => (await browser.evalInPage(PROBE)).annoCount > 0, { timeout: 20000, interval: 300, label: '标注框渲染' })
    .catch(() => {})
  if (useTemp) {
    await browser.evalInPage(api(`/api/sheet/${sheetId}/annotations`, { annotations: [...annoList, annoForTest] }))
  }
  await browser.evalInPage(api(`/api/sheet/${sheetId}/grading`, { items: {} }))
  await browser.goto(`${base}/sheet/${sheetId}`)
  await waitFor(async () => (await browser.evalInPage(PROBE)).annoCount > 0, { timeout: 20000, interval: 300, label: '标注框渲染' })
  await sleep(600)

  // ── 桌面：选中并判对 ──
  await browser.evalInPage(`document.querySelector('.sheet-anno:not(.draft)').click(); true`)
  await sleep(400)
  let s = await browser.evalInPage(PROBE)
  check('选中题目后侧栏出现判分控件', s.gradeBtns === 4, `按钮 ${s.gradeBtns} 个`)
  check('未判分时无画布角标', s.badge === null, JSON.stringify(s.badge))
  check('未判分时顶栏不显示得分', s.topScore === null, JSON.stringify(s.topScore))

  await browser.evalInPage(clickVerdict(0)) // ✓ 对
  await sleep(700)
  s = await browser.evalInPage(PROBE)
  check('判「对」后画布出现角标', !!s.badge && s.badge.text.includes('✓'),
    `角标 ${JSON.stringify(s.badge?.text)}`)
  check('角标在框内可见（尺寸不为 0）', s.badge && s.badge.w > 8 && s.badge.h > 8,
    `${s.badge?.w}×${s.badge?.h}`)
  check('侧栏汇总显示 2/2', (s.sum || '').replace(/\s/g, '') === '2/2', JSON.stringify(s.sum))
  check('正确率 100%', s.rate === '100%', JSON.stringify(s.rate))
  check('顶栏出现整卷得分', (s.topScore || '').replace(/\s/g, '') === '2/2', JSON.stringify(s.topScore))
  check('列表项显示单题分', (s.itemScore || '').includes('2/2'), JSON.stringify(s.itemScore))
  check('判定按钮高亮为「对」', (s.activeVerdict || '').includes('对'), JSON.stringify(s.activeVerdict))

  // ── 判错：得分归零，角标变色为 ✗ ──
  await browser.evalInPage(clickVerdict(2)) // ✗ 错
  await sleep(700)
  s = await browser.evalInPage(PROBE)
  check('判「错」后角标变 ✗', !!s.badge && s.badge.text.includes('✗'), JSON.stringify(s.badge?.text))
  check('判「错」后得分归零', (s.sum || '').replace(/\s/g, '') === '0/2', JSON.stringify(s.sum))
  check('正确率 0%', s.rate === '0%', JSON.stringify(s.rate))

  // ── 逐题手填满分：改满分 10，得分仍为 0 ──
  await browser.evalInPage(`(() => {
    const i = document.querySelector('.gn input')
    i.value = '10'; i.dispatchEvent(new Event('change', { bubbles: true })); return true
  })()`)
  await sleep(700)
  s = await browser.evalInPage(PROBE)
  check('改满分后分母变 10', (s.sum || '').replace(/\s/g, '') === '0/10', JSON.stringify(s.sum))
  check('改满分不会把「错」自动变「对」', (s.activeVerdict || '').includes('错'), JSON.stringify(s.activeVerdict))

  // ── 再判对，应拿满分 10 ──
  await browser.evalInPage(clickVerdict(0))
  await sleep(700)
  s = await browser.evalInPage(PROBE)
  check('满分 10 判对得 10 分', (s.sum || '').replace(/\s/g, '') === '10/10', JSON.stringify(s.sum))

  // ── 刷新留存 ──
  await browser.goto(`${base}/sheet/${sheetId}`)
  await waitFor(async () => (await browser.evalInPage(PROBE)).annoCount > 0, { timeout: 20000, interval: 300, label: '刷新后渲染' })
  await sleep(700)
  s = await browser.evalInPage(PROBE)
  check('刷新后判分留存', (s.topScore || '').replace(/\s/g, '') === '10/10', JSON.stringify(s.topScore))
  check('刷新后角标留存', !!s.badge && s.badge.text.includes('✓'), JSON.stringify(s.badge?.text))

  // ── 清空 ──
  await browser.evalInPage(`document.querySelector('.sheet-anno:not(.draft)').click(); true`)
  await sleep(350)
  await browser.evalInPage(`document.querySelector('.sp-grade-clear').click(); true`)
  await sleep(700)
  s = await browser.evalInPage(PROBE)
  check('清空后顶栏得分消失', s.topScore === null, JSON.stringify(s.topScore))
  check('清空后角标消失', s.badge === null, JSON.stringify(s.badge))

  // ── 手机：浮条判分 ──
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  })
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await sleep(600)
  await browser.evalInPage(`document.querySelector('.sheet-anno:not(.draft)').click(); true`)
  await sleep(450)
  s = await browser.evalInPage(PROBE)
  check('手机选中题目后浮出判分条', s.dock && s.dock.h > 30, `高 ${s.dock?.h}`)
  check('手机右侧面板已隐藏（判分不靠它）', !s.panel || s.panel.w === 0, `宽 ${s.panel?.w}`)
  check('浮条含四个判定按钮', s.dockBtns === 4, `按钮 ${s.dockBtns} 个`)
  check('浮条不出屏', s.dock && s.dock.right <= s.win + 0.5, `右 ${s.dock?.right} / 视口 ${s.win}`)

  await browser.evalInPage(`(() => {
    const b = document.querySelectorAll('.gd-v')[0]
    if (!b) return false
    b.click(); return true
  })()`)
  await sleep(700)
  s = await browser.evalInPage(PROBE)
  check('手机浮条判对生效', (s.topScore || '').replace(/\s/g, '') === '2/2', JSON.stringify(s.topScore))
  check('手机判分后画布角标可见', !!s.badge && s.badge.text.includes('✓'), JSON.stringify(s.badge?.text))
} finally {
  // ── 复原：标注与判分都按测试前原样写回 ──
  try {
    await browser.evalInPage(api(`/api/sheet/${sheetId}/annotations`, { annotations: annoList }))
    await browser.evalInPage(api(`/api/sheet/${sheetId}/grading`, { items: {} }))
    const after = await q('SELECT annotations FROM texts WHERE id=?', [sheetId])
    console.log(`\n复原：标注 ${JSON.parse(after[0]?.annotations || '[]').length} 条（原 ${annoList.length} 条）`)
  } catch (e) {
    console.log('复原失败，请手动检查：', e.message)
  }
  // grading 直接用原值写回，避免接口清洗把历史判分洗掉
  try {
    await qRun('UPDATE texts SET grading=? WHERE id=?', [origGrading, sheetId])
  } catch (e) {
    console.log('grading 复原失败：', e.message)
  }
  await browser.close()
}

console.log(`\n判分回归：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
