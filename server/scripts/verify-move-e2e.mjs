/**
 * 拖拽移动的端到端回归（真 Chrome，验证「移动成功后原位不该还有」）
 *
 * 为什么必须用真浏览器：这个 bug 全在客户端缓存层
 * （localStorage 快照 + useAsyncData 的 getCachedData）。
 * 接口和数据库一直是对的 —— 只拿 node 打接口，永远测不到用户真正看到的那一层。
 *
 * 模拟用户手动操作：
 *   1. 默认文件夹 → 拖一张卡片到目标文件夹
 *   2. 当前列表立即少一张（乐观更新）
 *   3. 切到目标文件夹：卡片在
 *   4. 切回默认文件夹：卡片不在        ← 核心断言（Nuxt 在 key 变化时会用
 *      cause='initial' 取缓存并短路，拿不到值就必须真请求）
 *   5. 人为把「移动前」的名单写成旧快照后刷新：首帧可以闪一下，但挂载后
 *      必须被真接口纠正 ← 断言闸门（snapshotGateOpen）确实关掉了
 *   6. 还原：把卡片移回默认文件夹，跑完不改变任何数据
 *
 * 用法：node server/scripts/verify-move-e2e.mjs [目标文件夹名]
 * 依赖：本地 dev 服务（默认 http://localhost:3000）+ Chrome/Edge + .env 的 SITE_PASSWORD
 */
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import path from 'node:path'

const env = readFileSync('.env', 'utf8').split(/\r?\n/).reduce((a, l) => {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) a[m[1]] = m[2].replace(/^["']|["']$/g, '')
  return a
}, {})

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const TOKEN = createHash('sha256').update(env.SITE_PASSWORD || '').digest('hex')
const TARGET_FOLDER_NAME = process.argv[2] || 'iran'
const SRC_FOLDER = 'default'
const PROFILE = path.resolve('server/data/.tmp-e2e-chrome')
const PORT = Number(process.env.CDP_PORT || 9333)

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok })
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

const api = async (pathname, init = {}) => {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { Cookie: `auth_token=${TOKEN}`, ...(init.headers || {}) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${text.slice(0, 200)}`)
  try { return JSON.parse(text) } catch { return text }
}
const listOf = (folder) => api(`/api/text/list?folder=${encodeURIComponent(folder)}`)

/** 轮询列表直到条件成立，返回耗时 —— 用来观察缓存失效的收敛窗口 */
async function pollList(folder, predicate, timeout = 2000) {
  const t0 = Date.now()
  let list = []
  while (Date.now() - t0 <= timeout) {
    list = await listOf(folder)
    if (predicate(list)) return { ok: true, ms: Date.now() - t0, list }
    await new Promise((r) => setTimeout(r, 100))
  }
  return { ok: false, ms: Date.now() - t0, list }
}

/* ---------------- CDP 最小客户端（Node 22 自带 WebSocket） ---------------- */

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync)
if (!CHROME) {
  console.error('找不到 Chrome/Edge，无法跑浏览器回归')
  process.exit(1)
}

let chromeProc = null
let ws = null
let sessionId = null
let seq = 0
const pending = new Map()

function send(method, params = {}, session = sessionId) {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }))
  })
}

async function evalInPage(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) {
    const d = r.exceptionDetails.exception?.description || r.exceptionDetails.text
    throw new Error('页面执行出错：' + String(d).split('\n')[0])
  }
  return r.result.value
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn, { timeout = 5000, interval = 100, label = '' } = {}) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    last = await fn()
    if (last) return last
    await sleep(interval)
  }
  throw new Error(`等待超时${label ? '：' + label : ''}`)
}

async function launch() {
  if (existsSync(PROFILE)) { try { rmSync(PROFILE, { recursive: true, force: true }) } catch {} }
  chromeProc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--mute-audio', '--window-size=1440,900',
    `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, 'about:blank',
  ], { stdio: 'ignore' })

  const version = await waitFor(async () => {
    try { return await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json() } catch { return null }
  }, { timeout: 15000, label: 'Chrome 启动' })

  ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', () => rej(new Error('CDP WebSocket 连接失败')), { once: true })
  })
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    }
  })

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, undefined)
  const attached = await send('Target.attachToTarget', { targetId, flatten: true }, undefined)
  sessionId = attached.sessionId
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Network.setCookie', { name: 'auth_token', value: TOKEN, url: `${BASE}/` })
}

async function close() {
  try { await send('Browser.close', {}, undefined) } catch {}
  try { ws?.close() } catch {}
  if (chromeProc && !chromeProc.killed) chromeProc.kill()
  await sleep(300)
  try { rmSync(PROFILE, { recursive: true, force: true }) } catch {}
}

/** 页面内的小工具：只在页面上下文里跑，改动文件后要重新注入 */
const HELPERS = `
window.__t = {
  books: (f) => fetch('/api/text/list?folder=' + encodeURIComponent(f)).then(r => r.json()),
  titles: () => Array.from(document.querySelectorAll('.doc-card .doc-title')).map(e => e.textContent.trim()),
  ready: () => document.readyState === 'complete',
  snapKeys: () => Object.keys(localStorage).filter(k => k.indexOf('yr-snap:') === 0),
  drag: (title, folderName) => {
    const card = Array.from(document.querySelectorAll('.doc-card'))
      .find(c => (c.querySelector('.doc-title')?.textContent || '').trim() === title)
    if (!card) return 'no-card'
    const folder = Array.from(document.querySelectorAll('.fs-card'))
      .find(c => (c.querySelector('.fsc-name')?.textContent || '').trim() === folderName)
    if (!folder) return 'no-folder'
    const dt = new DataTransfer()
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
    for (const type of ['dragenter', 'dragover', 'drop']) {
      folder.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
    }
    return 'ok'
  },
  clickFolder: (folderName) => {
    const folder = Array.from(document.querySelectorAll('.fs-card'))
      .find(c => (c.querySelector('.fsc-name')?.textContent || '').trim() === folderName)
    if (!folder) return false
    folder.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  },
  plantStale: (key, data) => { localStorage.setItem('yr-snap:' + key, JSON.stringify({ at: Date.now(), data })); return true },
  // 首屏真实渲染的卡片数（含快照占位），用于确认快照仍在工作
  cards: () => document.querySelectorAll('.doc-card').length,
}
`

async function goto(url) {
  await send('Page.navigate', { url })
  await waitFor(() => evalInPage('document.readyState === "complete"').catch(() => false),
    { timeout: 15000, label: '页面加载' })
  await evalInPage(HELPERS)
}

const titles = () => evalInPage('window.__t.titles()')
const waitTitle = (title, present, ms = 4000) => waitFor(
  async () => (await titles()).includes(title) === present,
  { timeout: ms, label: `${present ? '出现' : '消失'}「${title}」` },
)

/* ------------------------------- 主流程 ------------------------------- */

let moved = null      // { id, title, from }
let restored = false

try {
  console.log(`\n目标文件夹：${TARGET_FOLDER_NAME}   启动浏览器…`)
  await launch()
  await goto(`${BASE}/`)

  const folders = await api('/api/folder/list')
  const target = folders.find((f) => (f.name || '').trim().toLowerCase() === TARGET_FOLDER_NAME.toLowerCase())
  if (!target) throw new Error(`文件夹「${TARGET_FOLDER_NAME}」不存在，可选：${folders.map(f => f.name).join(' / ')}`)
  if (target.id === SRC_FOLDER) throw new Error('目标文件夹不能是默认文件夹')
  const targetName = target.name.trim()
  const srcName = folders.find((f) => f.id === SRC_FOLDER)?.name?.trim() || '默认文件夹'
  console.log(`源：${srcName}(${SRC_FOLDER})   目标：${targetName}(${target.id})`)

  // 必须等真的出卡片：默认文件夹是空的才允许走空态，否则「等待 → 立刻断言」会撞在
  // 首屏还没到数据的空态上，测出一个假失败
  await waitFor(() => evalInPage('window.__t.cards() > 0'), { timeout: 15000, label: '书架出卡片' })
  const srcBefore = await listOf(SRC_FOLDER)
  const dstBefore = await listOf(target.id)

  // 选一张不在目标文件夹里的卡片（避免重名干扰断言）
  const dstTitles = new Set(dstBefore.map((b) => b.title))
  const pick = srcBefore.find((b) => b.title && !dstTitles.has(b.title))
  if (!pick) throw new Error('默认文件夹里没有可用的测试卡片')
  moved = { id: pick.id, title: pick.title, from: SRC_FOLDER }
  console.log(`测试卡片：「${pick.title}」(${pick.id})`)

  check('0 拖拽前：卡片在默认文件夹的书架里', (await titles()).includes(pick.title))

  // ---- 1. 拖拽移动 ----
  const dragResult = await evalInPage(`window.__t.drag(${JSON.stringify(pick.title)}, ${JSON.stringify(targetName)})`)
  check('1 拖拽事件成功派发到目标文件夹', dragResult === 'ok', dragResult !== 'ok' ? dragResult : '')
  await waitTitle(pick.title, false)
  check('2 移动后当前（默认）列表里卡片立即消失', !(await titles()).includes(pick.title))

  // 接口层：本地接口有 60s 的列表缓存（增删改会 clearCache），这里允许一个很短的
  // 失效窗口，但要确认它自己会收敛 —— 用户真正看到的是下面的 DOM 断言。
  const srcAfter = await pollList(SRC_FOLDER, (list) => !list.some((b) => b.id === pick.id), 2000)
  const dstAfter = await listOf(target.id)
  check('3 接口层：卡片已不在默认文件夹', srcAfter.ok,
    srcAfter.ok ? `收敛 ${srcAfter.ms}ms` : `2s 内仍返回 ${srcAfter.list.length} 条`)
  check('4 接口层：卡片已在目标文件夹', dstAfter.some((b) => b.id === pick.id))

  // ---- 2. 切到目标文件夹 ----
  const clicked1 = await evalInPage(`window.__t.clickFolder(${JSON.stringify(targetName)})`)
  check('5 侧栏点得到目标文件夹', clicked1)
  await waitTitle(pick.title, true)
  check('6 切到目标文件夹能看到卡片', (await titles()).includes(pick.title))

  // ---- 3. 切回默认文件夹（核心：旧快照不得回流） ----
  const clickedBack = await evalInPage(`window.__t.clickFolder(${JSON.stringify(srcName)})`)
  if (!clickedBack) {
    await goto(`${BASE}/?folder=${SRC_FOLDER}`)
  }
  // 换文件夹后接口 7ms，这里给足冗余等一次真请求落地
  await sleep(1200)
  const backTitles = await titles()
  check('7 切回默认文件夹后卡片不再出现（旧快照没回流）', !backTitles.includes(pick.title),
    backTitles.includes(pick.title) ? `仍渲染 ${backTitles.length} 张，含该卡片` : '')

  // ---- 4. 旧快照污染测试：人为写入「移动前」名单再刷新 ----
  // 关键：要在「文档开始执行前」就挂上探针（addScriptToEvaluateOnNewDocument），
  // 否则等 readyState=complete 再注入，快照那一帧早就过去了，测不到。
  await goto(`${BASE}/?folder=${SRC_FOLDER}`)
  await evalInPage(`window.__t.plantStale('books-${SRC_FOLDER}', ${JSON.stringify(srcBefore)})`)
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const MOVED = ${JSON.stringify(pick.title)}
      const boot = { firstCardAt: null, firstCount: 0, firstHasMoved: false, maxCount: 0,
                     settledCount: 0, settledHasMoved: null, correctionAt: null, frames: 0 }
      window.__boot = boot
      const tick = () => {
        const t = performance.now()
        const cards = document.querySelectorAll('.doc-card')
        const n = cards.length
        const hasMoved = MOVED && document.body ? document.body.innerText.indexOf(MOVED) >= 0 : false
        if (n > 0 && boot.firstCardAt === null) { boot.firstCardAt = Math.round(t); boot.firstCount = n; boot.firstHasMoved = hasMoved }
        if (n > boot.maxCount) boot.maxCount = n
        if (boot.firstCardAt !== null) {
          boot.settledCount = n; boot.settledHasMoved = hasMoved
          if (boot.correctionAt === null && !hasMoved) boot.correctionAt = Math.round(t)
        }
        if (++boot.frames < 900) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })()`,
  })
  await send('Page.reload', { ignoreCache: false })
  await waitFor(() => evalInPage('document.readyState === "complete"').catch(() => false),
    { timeout: 15000, label: '刷新完成' })
  await sleep(2500) // 等真请求落地并被探针记录
  const boot = await evalInPage('window.__boot')
  check('8 首帧先用旧快照占位（还带着已移走的卡片）',
    !!boot && boot.firstCount === srcBefore.length && boot.firstHasMoved === true,
    boot ? `首帧 ${boot.firstCount}/${srcBefore.length} 张，含移走卡片=${boot.firstHasMoved}` : '探针没跑起来')
  check('9 挂载后真接口纠正旧快照（闸门生效）',
    !!boot && boot.settledHasMoved === false && boot.settledCount === srcBefore.length - 1,
    boot ? `稳定后 ${boot.settledCount} 张，含移走卡片=${boot.settledHasMoved}` : '')

  const dstAfterReload = await listOf(target.id)
  check('10 刷新后目标文件夹依然有卡片（数据没丢）', dstAfterReload.some((b) => b.id === pick.id))

  // ---- 5. 还原 ----
  await api('/api/text/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: pick.id, folder: SRC_FOLDER }),
  })
  restored = true
  const backHome = await listOf(SRC_FOLDER)
  const dstFinal = await listOf(target.id)
  check('11 还原：卡片回到默认文件夹', backHome.some((b) => b.id === pick.id))
  check('12 还原：目标文件夹里已无该卡片', !dstFinal.some((b) => b.id === pick.id))
} catch (e) {
  check('执行异常', false, String(e?.message || e))
} finally {
  // 兜底还原：中途失败也不把用户的书挪走
  if (moved && !restored) {
    try {
      await api('/api/text/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: moved.id, folder: moved.from }),
      })
      console.log(`\n（兜底）已把「${moved.title}」移回 ${moved.from}`)
    } catch (e) {
      console.error(`\n！！还原失败，请手动把 ${moved.id} 移回 ${moved.from}`, e?.message)
    }
  }
  await close()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
  if (failed.length) {
    console.log('失败项：' + failed.map((f) => f.name).join(' / '))
    process.exitCode = 1
  }
}
