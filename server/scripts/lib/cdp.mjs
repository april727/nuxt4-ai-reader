/**
 * 真浏览器回归用的最小 CDP 客户端（Node 22 自带 WebSocket，无第三方依赖）。
 *
 * 为什么测试要真浏览器：书架/试卷这类页面的 bug 常常在「客户端缓存 + 组件状态」
 * 这一层，接口和数据库都是对的 —— 只用 node 打接口永远测不到用户看到的那一层。
 */
import { existsSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync)

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function waitFor(fn, { timeout = 5000, interval = 100, label = '' } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await fn()) return true
    await sleep(interval)
  }
  throw new Error(`等待超时${label ? '：' + label : ''}`)
}

/**
 * 挑一个真正能连上 Nuxt 的基址。
 *
 * Windows 上 `localhost` 可能先解析到 127.0.0.1，而 Nuxt dev 只监听 [::1]；
 * 某些环境里 127.0.0.1:3000 还会被本地代理接管、返回 502 —— 浏览器拿到的是一个
 * 502 错误页，于是所有断言都在「页面上什么都没有」上失败，看起来像前端崩了。
 * 所以先探测，拿到能用的那个再交给 Chrome。
 */
export async function resolveBase(preferred) {
  const cands = preferred ? [preferred] : ['http://127.0.0.1:3000', 'http://[::1]:3000', 'http://localhost:3000']
  for (const b of cands) {
    try {
      const r = await fetch(`${b}/`, { redirect: 'manual', signal: AbortSignal.timeout(4000) })
      if (r.status && r.status !== 502) return b
    } catch { /* 试下一个 */ }
  }
  return preferred || cands[1]
}

export async function launchChrome({ port = 9333, profile, base, token }) {
  if (!CHROME) throw new Error('找不到 Chrome/Edge，无法跑浏览器回归')
  const dir = path.resolve(profile)
  if (existsSync(dir)) { try { rmSync(dir, { recursive: true, force: true }) } catch { /* 占用中就算了 */ } }

  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--mute-audio', '--window-size=1440,900',
    `--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, 'about:blank',
  ], { stdio: 'ignore' })

  const version = await (async () => {
    let ok = null
    await waitFor(async () => {
      try { ok = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); return true } catch { return false }
    }, { timeout: 15000, label: 'Chrome 启动' })
    return ok
  })()

  const ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', () => rej(new Error('CDP WebSocket 连接失败')), { once: true })
  })

  let seq = 0
  let sessionId = null
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    }
  })

  const send = (method, params = {}, session) => {
    const id = ++seq
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params, ...((session ?? sessionId) ? { sessionId: session ?? sessionId } : {}) }))
    })
  }

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, undefined)
  const attached = await send('Target.attachToTarget', { targetId, flatten: true }, undefined)
  sessionId = attached.sessionId
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Network.setCookie', { name: 'auth_token', value: token, url: `${base}/` })

  const evalInPage = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) {
      const d = r.exceptionDetails.exception?.description || r.exceptionDetails.text
      throw new Error('页面执行出错：' + String(d).split('\n')[0])
    }
    return r.result.value
  }

  const goto = async (url, extra = '') => {
    await send('Page.navigate', { url })
    // dev 模式下首屏要等 Vite 编译 + 大图解码，实测 8s 才到 complete，留足冗余
    await waitFor(() => evalInPage('document.readyState === "complete"').catch(() => false),
      { timeout: 30000, label: '页面加载' })
    if (extra) await evalInPage(extra)
  }

  const close = async () => {
    try { await send('Browser.close', {}, null) } catch { /* ignore */ }
    try { ws.close() } catch { /* ignore */ }
    if (!proc.killed) proc.kill()
    await sleep(300)
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  return { send, evalInPage, goto, close, chrome: CHROME }
}
