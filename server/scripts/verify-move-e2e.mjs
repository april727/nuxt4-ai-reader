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
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { launchChrome, resolveBase, sleep, waitFor } from './lib/cdp.mjs'

const env = readFileSync('.env', 'utf8').split(/\r?\n/).reduce((a, l) => {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/m)
  if (m) a[m[1]] = m[2].replace(/^["']|["']$/g, '')
  return a
}, {})

const BASE = await resolveBase(process.env.BASE_URL)
const TOKEN = createHash('sha256').update(env.SITE_PASSWORD || '').digest('hex')
const TARGET_FOLDER_NAME = process.argv[2] || 'iran'
const SRC_FOLDER = 'default'

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
    await sleep(100)
  }
  return { ok: false, ms: Date.now() - t0, list }
}

let page = null

const HELPERS = `window.__t = {
  titles: () => Array.from(document.querySelectorAll('.doc-card .doc-title')).map(e => e.textContent.trim()),
  cards: () => document.querySelectorAll('.doc-card').length,
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
}`

const evalInPage = (expr) => page.evalInPage(expr)
const goto = (url, extra) => page.goto(url, extra)
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
  page = await launchChrome({ profile: 'server/data/.tmp-e2e-chrome', base: BASE, token: TOKEN })
  await goto(`${BASE}/`, HELPERS)

  const folders = await api('/api/folder/list')
  const target = folders.find((f) => (f.name || '').trim().toLowerCase() === TARGET_FOLDER_NAME.toLowerCase())
  if (!target) throw new Error(`文件夹「${TARGET_FOLDER_NAME}」不存在，可选：${folders.map(f => f.name).join(' / ')}`)
  if (target.id === SRC_FOLDER) throw new Error('目标文件夹不能是默认文件夹')
  const targetName = target.name.trim()
  const srcName = folders.find((f) => f.id === SRC_FOLDER)?.name?.trim() || '默认文件夹'
  console.log(`源：${srcName}(${SRC_FOLDER})   目标：${targetName}(${target.id})`)

  // 必须等真的出卡片：默认文件夹是空的才允许走空态，否则「等待 → 立刻断言」会撞在
  // 首屏还没到数据的空态上，测出一个假失败
  await waitFor(() => evalInPage('window.__t.cards() > 0'), { timeout: 30000, label: '书架出卡片' })
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
    await goto(`${BASE}/?folder=${SRC_FOLDER}`, HELPERS)
  }
  // 换文件夹后接口 7ms，这里给足冗余等一次真请求落地
  await sleep(1200)
  const backTitles = await titles()
  check('7 切回默认文件夹后卡片不再出现（旧快照没回流）', !backTitles.includes(pick.title),
    backTitles.includes(pick.title) ? `仍渲染 ${backTitles.length} 张，含该卡片` : '')

  // ---- 4. 旧快照污染测试：人为写入「移动前」名单再刷新 ----
  // 关键：要在「文档开始执行前」就挂上探针（addScriptToEvaluateOnNewDocument），
  // 否则等 readyState=complete 再注入，快照那一帧早就过去了，测不到。
  await goto(`${BASE}/?folder=${SRC_FOLDER}`, HELPERS)
  await evalInPage(`window.__t.plantStale('books-${SRC_FOLDER}', ${JSON.stringify(srcBefore)})`)
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
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
  await page.send('Page.reload', { ignoreCache: false })
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
  await page?.close()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
  if (failed.length) {
    console.log('失败项：' + failed.map((f) => f.name).join(' / '))
    process.exitCode = 1
  }
}
