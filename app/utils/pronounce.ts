/**
 * 发音模块（浏览器版）—— 服务端代理优先，直连音库兜底。
 *
 * ============================ 架构 ============================
 * 主路径（快、稳）：
 *   浏览器 → POST /api/pronounce/resolve → 服务端直连音库 + 落盘缓存
 *   → 返回音频地址 → 浏览器 <audio> 播放
 *
 * 兜底路径（服务端不可用时）：
 *   浏览器 → 直连 audio.beingfine.cn（fetch 探测会被 CORS 拦，退回 <audio> 探测）
 *
 * ============================ 为什么改 ============================
 * 旧实现全部在浏览器里探测，踩了三个坑：
 *   1. 音库 CDN 不返回 CORS 头 → 浏览器 fetch/HEAD 直接被 CORS 策略拒绝（网络错误，
 *      不是 404），每个词都要浪费一次失败请求再退回 <audio> 元素探测。
 *   2. 音库只收原形 → 变形词要串行试 2~3 个候选原形，每个候选 ~700ms 往返，
 *      叠加后单个词最慢要等 2 秒以上 —— 这就是"反应慢"的主因。
 *   3. 探测结果只存在内存 → 每次刷新页面都要把整篇单词重新探测一遍。
 * 服务端没有 CORS 限制，可以并发探测 + 落盘缓存，把这些开销一次付清。
 *
 * 词形还原逻辑来自 shared/utils/pronounce（前后端共用，口径一致）。
 */

import { pronCandidates } from '#shared/utils/pronounce'

const BASE = 'https://audio.beingfine.cn/speeches'
const ACCENTS = ['UK', 'US'] as const
export type Accent = 'UK' | 'US'

/** 解析缓存：`catches:UK` → { src, via, word } | null（null=确认无音，不缓存不确定结果） */
const resolveCache: Record<string, { src: string; via: string; word: string } | null> = {}
/** 命中缓存：`faint:UK` → true / false（null 不写，留待重试） */
const hitCache: Record<string, boolean> = {}

/** 服务端不可用时置位，之后不再反复尝试服务端 */
let serverDown = false

/**
 * 音库防盗链：audio.beingfine.cn 对陌生 Referer 返回 403（实测发布域被拒、localhost 放行）。
 * 两个应对：
 *   1. 音频元素设 referrerPolicy='no-referrer'，浏览器干脆不发 Referer（首选，零成本）
 *   2. 仍失败则改走本站代理 /api/pronounce/audio（服务端无 Referer，必定可播）
 */
const AUDIO_PROXY = '/api/pronounce/audio'

export function proxyAudioUrl(src: string): string {
  if (!src) return src
  if (src.startsWith(AUDIO_PROXY)) return src
  if (!/^https?:\/\//i.test(src)) return src
  return `${AUDIO_PROXY}?u=${encodeURIComponent(src)}`
}

/** 统一创建音频元素：禁用 Referer，避免音库防盗链 403 */
function newAudioEl(): HTMLAudioElement {
  const a = new Audio()
  try { a.referrerPolicy = 'no-referrer' } catch {}
  return a
}

export function pronUrlOf(word: string, accent: Accent = 'UK'): string {
  const a = (ACCENTS as readonly string[]).includes(accent) ? accent : 'UK'
  return `${BASE}/${a}/${a}-speech/${word}.mp3`
}

export { pronCandidates }

/* ---------------- 探测与解析（直连兜底） ---------------- */

function audioProbe(url: string): Promise<'yes' | 'no' | 'timeout'> {
  return new Promise((resolve) => {
    let a: HTMLAudioElement
    try { a = newAudioEl() } catch { resolve('no'); return }
    let settled = false
    const timer = setTimeout(() => finish('timeout'), 6000)
    function finish(v: 'yes' | 'no' | 'timeout') {
      if (settled) return
      settled = true
      clearTimeout(timer)
      a.onloadedmetadata = a.oncanplaythrough = a.onerror = null
      try { a.pause(); a.removeAttribute('src'); a.load() } catch {}
      resolve(v)
    }
    a.preload = 'metadata'
    a.onloadedmetadata = () => finish('yes')
    a.oncanplaythrough = () => finish('yes')
    a.onerror = () => finish('no')
    a.src = url
  })
}

function probe(word: string, accent: Accent): Promise<boolean | null> {
  const url = pronUrlOf(word, accent)
  return fetch(url, { method: 'HEAD', cache: 'force-cache' })
    .then((r) => {
      if (r.status === 200 || r.status === 206) return true
      if (r.status === 404) return false
      return audioProbe(url).then((v) => (v === 'yes' ? true : v === 'no' ? false : null))
    })
    .catch(() => audioProbe(url).then((v) => (v === 'yes' ? true : v === 'no' ? false : null)))
}

function checkWord(word: string, accent: Accent): Promise<boolean> {
  const key = `${word}:${accent}`
  if (hitCache[key] !== undefined) return Promise.resolve(hitCache[key])
  return probe(word, accent).then((ok) => {
    if (ok === true || ok === false) hitCache[key] = ok // null 不写缓存，留待重试
    return ok === true
  })
}

/* ---------------- 服务端代理 ---------------- */

interface ServerResults { [word: string]: { url: string; via: string } | null }

/**
 * 调服务端批量解析。
 *
 * 返回值区分两种"没有"：
 *   'ok'      → 服务端正常响应，结果在 resolveCache 里（可能是 null = 音库确实没有）
 *   'failed'  → 服务端不可用（网络错误/超时），调用方应转直连兜底
 *
 * 关键：服务端返回 null 是**权威结论**（它已经查过原形和所有候选原形），
 * 此时绝不能再走浏览器直连兜底 —— 那会白白触发一轮被 CORS 拦截的慢探测。
 */
async function resolveViaServer(words: string[], accent: Accent): Promise<'ok' | 'failed'> {
  if (serverDown) return 'failed'
  try {
    const res = await $fetch<{ results: ServerResults }>('/api/pronounce/resolve', {
      method: 'POST',
      body: { words, accent },
      timeout: 15000,
    })
    const map = res?.results || {}
    for (const w of words) {
      const key = `${w}:${accent}`
      const hit = map[w]
      if (hit && hit.url) {
        resolveCache[key] = { src: hit.url, via: hit.via || w, word: w }
      } else {
        // 服务端明确返回 null = 音库里确实没有（已试过原形与所有候选），缓存结论
        resolveCache[key] = null
        hitCache[key] = false
      }
    }
    return 'ok'
  } catch {
    serverDown = true
    // 30 秒后允许再试服务端
    setTimeout(() => { serverDown = false }, 30000)
    return 'failed'
  }
}

/** 查一个词的发音，变形词自动还原。查不到返回 null */
export function pronResolve(word: string, accent: Accent = 'UK'): Promise<{ src: string; via: string; word: string } | null> {
  if (import.meta.server) return Promise.resolve(null)
  const w = String(word || '').toLowerCase()
  const key = `${w}:${accent}`
  if (resolveCache[key] !== undefined) return Promise.resolve(resolveCache[key])

  const done = (v: { src: string; via: string; word: string } | null) => {
    if (v !== null) resolveCache[key] = v
    return v
  }

  // 主路径：走服务端代理
  if (!serverDown) {
    return resolveViaServer([w], accent).then((status) => {
      // 'ok' = 服务端正常响应（结果可能是 null = 音库确实没这个词，是权威结论）
      if (status === 'ok') return done(resolveCache[key] ?? null)
      // 'failed' = 服务端不可用 → 直连兜底
      return resolveDirect(w, accent).then(done)
    })
  }

  return resolveDirect(w, accent).then(done)
}

/** 直连兜底：原形 + 候选原形逐个探测 */
function resolveDirect(w: string, accent: Accent): Promise<{ src: string; via: string; word: string } | null> {
  return checkWord(w, accent).then((ok) => {
    if (ok) return { src: pronUrlOf(w, accent), via: w, word: w }
    const cands = pronCandidates(w)
    if (!cands.length) return null
    let i = 0
    const next = (): Promise<{ src: string; via: string; word: string } | null> => {
      if (i >= cands.length) return null
      const c = cands[i++]
      return checkWord(c, accent).then((hit) => {
        if (hit) return { src: pronUrlOf(c, accent), via: c, word: w }
        return next()
      })
    }
    return next()
  })
}

/**
 * 批量预解析（阅读页加载时调用，把整篇用词一次性解析好并落进服务端缓存）。
 * 之后用户点任何词都是「缓存命中 → 立即播」，不再有探测延迟。
 */
/**
 * 批量预解析（阅读页加载时调用，把整篇用词一次性解析好并落进服务端缓存）。
 * 之后用户点任何词都是「缓存命中 → 立即播」，不再有探测延迟。
 *
 * 分批：服务端单次上限 500 词，一篇长文可能有上千个词，所以按 400 一批
 * 顺序推进（不并发，避免和用户实际点击的请求抢带宽），全部在后台静默进行。
 */
export function pronPrefetch(words: string[], accent: Accent = 'UK'): void {
  if (import.meta.server) return
  const uniq: string[] = []
  for (const raw of words) {
    const w = String(raw || '').toLowerCase().trim()
    if (!w || !/^[a-z][a-z'-]*$/.test(w)) continue
    if (resolveCache[`${w}:${accent}`] !== undefined) continue
    if (!uniq.includes(w)) uniq.push(w)
  }
  if (!uniq.length) return

  const BATCH = 400
  for (let i = 0; i < uniq.length; i += BATCH) {
    const batch = uniq.slice(i, i + BATCH)
    // 每批独立排队：前一批完成后再发下一批
    void (async () => {
      const r = await resolveViaServer(batch, accent)
      if (r === 'failed') {
        // 服务端不可用：等一会再试这一批（不阻塞后续批次）
        await new Promise(res => setTimeout(res, 5000))
        await resolveViaServer(batch, accent)
      }
    })()
  }
}

/* ---------------- 共享播放器单例 ---------------- */

/**
 * 全局共享的串行播放器。
 * 为什么要共享：每次 new Audio 播同一个词会互相打断（浏览器对同一媒体源的并发
 * play 会让后一个抢掉前一个），并且无法保证"放完再放下一个"。所有发音入口
 * （阅读页、生词本、复习页）共用这一个实例，天然串行、不会打架。
 */
let sharedPlayer: PronPlayer | null = null

export function getSharedPronPlayer(): PronPlayer {
  if (!sharedPlayer) sharedPlayer = createPronPlayer()
  return sharedPlayer
}

/* ---------------- 拆词与统计 ---------------- */

/** 拆词：只认字母和词内连字符/撇号 */
export function pronTokenize(text: string): string[] {
  const out: string[] = []
  const raw = String(text || '').toLowerCase()
  const re = /[a-z]+(?:['\-][a-z]+)*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) out.push(m[0])
  return out
}

export interface PronWordInfo { text: string; index: number; hit: boolean; via: string; src: string }
export interface PronAnalysis { words: PronWordInfo[]; covered: number; playable: boolean; missCount: number }

/** 拆句并解析每个词的发音；playable 要求 100% 覆盖 */
export function pronAnalyze(text: string, accent: Accent = 'UK'): Promise<PronAnalysis> {
  if (import.meta.server) return Promise.resolve({ words: [], covered: 0, playable: false, missCount: 0 })
  const words = pronTokenize(text)
  if (!words.length) return Promise.resolve({ words: [], covered: 0, playable: false, missCount: 0 })

  const uniq: string[] = []
  words.forEach((w) => { if (!uniq.includes(w)) uniq.push(w) })

  return Promise.all(uniq.map((w) => pronResolve(w, accent))).then((results) => {
    const map: Record<string, { src: string; via: string; word: string } | null> = {}
    uniq.forEach((w, i) => { map[w] = results[i] })
    let hitCount = 0
    const list: PronWordInfo[] = words.map((w, i) => {
      const r = map[w]
      if (r) hitCount++
      return { text: w, index: i, hit: !!r, via: r ? r.via : '', src: r ? r.src : '' }
    })
    return { words: list, covered: hitCount / words.length, playable: hitCount === words.length, missCount: words.length - hitCount }
  })
}

/* ---------------- 串行播放器 ---------------- */

export interface PronPlayer {
  playOne(src: string, wordIndex?: number): void
  /** 播放一个音频并等待播完（Promise 版）；返回是否真正播出声音，供上层决定是否回退合成音 */
  playOneAsync(src: string): Promise<boolean>
  playQueue(items: { src: string; wordIndex?: number }[]): void
  isPlaying(): boolean
  stop(): void
  destroy(): void
}

/** 串行播放器：放完一段再播下一段（换 src 立即 play 会被浏览器吞音），词间 220ms */
export function createPronPlayer(options?: { gapMs?: number; onWord?: (i: number) => void; onEnd?: () => void; onError?: () => void }): PronPlayer {
  if (import.meta.server) {
    return { playOne() {}, playOneAsync: () => Promise.resolve(false), playQueue() {}, isPlaying: () => false, stop() {}, destroy() {} }
  }
  const opt = options || {}
  const gap = opt.gapMs == null ? 220 : opt.gapMs
  const onWord = opt.onWord || (() => {})
  const onEnd = opt.onEnd || (() => {})
  const onError = opt.onError || (() => {})

  let queue: { src: string; wordIndex: number }[] = []
  let cursor = 0
  let token = 0
  let playing = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let audio: HTMLAudioElement | null = null

  function ctx(): HTMLAudioElement {
    if (!audio) { audio = newAudioEl(); audio.preload = 'auto' }
    return audio
  }
  function clearTimer() { if (timer) { clearTimeout(timer); timer = null } }
  function detach() { const a = ctx(); a.onended = null; a.onerror = null }
  function later(myToken: number, ms: number) {
    timer = setTimeout(() => step(myToken), ms)
  }
  function finish(myToken: number) {
    if (myToken !== token) return
    playing = false
    cursor = 0; queue = []
    detach()
    onWord(-1); onEnd()
  }
  function step(myToken: number) {
    if (myToken !== token) return
    if (cursor >= queue.length) return finish(myToken)
    const item = queue[cursor]; cursor++
    onWord(item.wordIndex)
    const a = ctx()
    detach()
    a.onended = () => { if (myToken !== token) return; cursor < queue.length ? later(myToken, gap) : finish(myToken) }
    a.onerror = () => {
      if (myToken !== token) return
      // 防盗链 403 等加载失败 → 同一段改走服务端代理再试一次（src 被替换后不会重复触发）
      const proxied = proxyAudioUrl(item.src)
      if (proxied !== item.src) {
        item.src = proxied
        cursor--
        later(myToken, 40)
        return
      }
      if (cursor < queue.length) later(myToken, 60)
      else { finish(myToken); onError() }
    }
    a.src = item.src
    const p = a.play()
    if (p && p.catch) {
      p.catch(() => {
        if (myToken !== token) return
        if (cursor < queue.length) later(myToken, 60)
        else finish(myToken)
      })
    }
  }

  return {
    playOne(src: string, wordIndex?: number) {
      if (!src) return
      this.stop()
      token++; playing = true; queue = [{ src, wordIndex: wordIndex == null ? -1 : wordIndex }]; cursor = 0
      step(token)
    },
    playOneAsync(src: string): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        if (!src) { resolve(false); return }
        const myToken = token + 1
        this.stop()
        token = myToken; playing = true
        queue = [{ src, wordIndex: -1 }]; cursor = 0
        const a = ctx()
        detach()
        let settled = false
        let ok = false
        let curSrc = src
        let retried = false
        const fin = (success: boolean) => {
          if (settled) return
          settled = true
          resolve(success || ok)
        }
        const fail = () => {
          if (myToken !== token) { fin(false); return }
          // 首次失败 → 改走服务端代理再试（应对音库防盗链 403）
          const proxied = proxyAudioUrl(curSrc)
          if (!retried && proxied !== curSrc) {
            retried = true
            curSrc = proxied
            setTimeout(() => {
              if (settled || myToken !== token) { fin(false); return }
              a.src = curSrc
              const p2 = a.play()
              if (p2 && p2.catch) p2.catch(() => fin(false))
            }, 60)
            return
          }
          fin(false)
        }
        a.onended = () => { ok = true; fin(true) }
        a.onerror = () => fail()
        a.src = curSrc
        const p = a.play()
        if (p && p.catch) {
          p.catch(() => {
            // 播放被拦截（自动播放策略/网络抖动）：重试一次
            if (myToken !== token) { fin(false); return }
            setTimeout(() => {
              if (settled || myToken !== token) { fin(false); return }
              const p2 = a.play()
              if (p2 && p2.catch) p2.catch(() => fail())
            }, 120)
          })
        }
        // 播完才有 onended；兜底超时按"未成功"处理
        setTimeout(() => fin(ok), 10000)
      })
    },
    playQueue(items: { src: string; wordIndex?: number }[][]) {
      const list = (items || []).filter((i) => i && i.src)
      if (!list.length) return
      this.stop()
      token++; playing = true; queue = list; cursor = 0
      step(token)
    },
    isPlaying: () => playing,
    stop() {
      clearTimer(); token++; playing = false; cursor = 0; queue = []
      if (audio) { detach(); try { audio.pause(); audio.currentTime = 0 } catch {} }
      onWord(-1)
    },
    destroy() { this.stop(); audio = null },
  }
}
