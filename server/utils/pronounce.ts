/**
 * 发音代理（服务端）
 *
 * 为什么需要服务端代理：
 *   音库 CDN（audio.beingfine.cn）**不返回 CORS 头**，浏览器里 fetch/HEAD 会被 CORS
 *   策略直接拦截（不是 404，是网络错误），导致：
 *     1. 每个词都要先浪费一次失败的 fetch，再退回 <audio> 元素兜底探测 → 慢
 *     2. 变形词要串行试 2-3 个候选，每个 ~700ms → 更慢
 *     3. 探测结果无法持久化 → 每次刷新页面都要重头再来
 *   服务端没有 CORS 限制，可以直接 HEAD 探测并把结果缓存下来。
 *
 * 缓存分层：
 *   - 内存 Map：进程内，命中即返回
 *   - 落盘 JSON：进程重启后仍有效（server/data/pronounce-cache.json）
 *
 * 缓存语义与前端一致：
 *   - 命中（200/206）→ 记录 url
 *   - 明确 404 → 记录 miss（短期不再重试，避免每次都白等）
 *   - 网络异常/超时 → 不写缓存，留待重试
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://audio.beingfine.cn/speeches'
const ACCENTS = ['UK', 'US'] as const
export type Accent = 'UK' | 'US'

const CACHE_FILE = join(process.cwd(), 'server', 'data', 'pronounce-cache.json')
/** miss 缓存 TTL：音库是静态的，404 基本不会变，但留个较长的 TTL 以防音库后续补词 */
const MISS_TTL = 7 * 24 * 60 * 60 * 1000
/** 内存缓存 miss 的 TTL */
const MISS_TTL_MEM = 60 * 60 * 1000

export interface PronEntry {
  /** 命中时的音频地址 */
  url?: string
  /** 命中的实际词（原形），未命中为空 */
  via?: string
  /** 是否明确未命中（音库 404） */
  miss?: boolean
  /** miss 的过期时间戳 */
  expire?: number
}

type CacheShape = Record<string, PronEntry>

let mem: CacheShape = {}
let loaded = false
let dirty = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

function loadCache() {
  if (loaded) return
  loaded = true
  try {
    if (existsSync(CACHE_FILE)) {
      const raw = readFileSync(CACHE_FILE, 'utf-8')
      const obj = JSON.parse(raw)
      if (obj && typeof obj === 'object') mem = obj as CacheShape
    }
  } catch {
    mem = {}
  }
}

function scheduleSave() {
  dirty = true
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (!dirty) return
    dirty = false
    try {
      const dir = join(process.cwd(), 'server', 'data')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const tmp = CACHE_FILE + '.tmp'
      writeFileSync(tmp, JSON.stringify(mem), 'utf-8')
      renameSync(tmp, CACHE_FILE)
    } catch {
      /* 落盘失败不影响功能，内存缓存继续生效 */
    }
  }, 3000)
}

export function cacheStats() {
  loadCache()
  let hit = 0, miss = 0
  const now = Date.now()
  for (const k of Object.keys(mem)) {
    const e = mem[k]
    if (e?.miss) { if ((e.expire || 0) > now) miss++ }
    else if (e?.url) hit++
  }
  return { hit, miss, total: hit + miss }
}

export function pronUrlOf(word: string, accent: Accent = 'UK'): string {
  const a = (ACCENTS as readonly string[]).includes(accent) ? accent : 'UK'
  return `${BASE}/${a}/${a}-speech/${word}.mp3`
}

/** 读缓存完整条目（含 via），未命中返回 undefined */
export function getPronEntry(word: string, accent: Accent = 'UK'): { url: string; via: string } | undefined {
  loadCache()
  const key = `${word}:${accent}`
  const e = mem[key]
  if (!e) return undefined
  if (e.miss) {
    if ((e.expire || 0) > Date.now()) return undefined
    delete mem[key]
    scheduleSave()
    return undefined
  }
  if (!e.url) return undefined
  return { url: e.url, via: e.via || word }
}

/** 读缓存：命中返回 url，未命中返回 undefined（需要探测） */
export function getPronCached(word: string, accent: Accent = 'UK'): string | undefined {
  return getPronEntry(word, accent)?.url
}

/** 写缓存 */
export function setPronCached(word: string, accent: Accent, url: string, via: string) {
  loadCache()
  mem[`${word}:${accent}`] = { url, via }
  scheduleSave()
}

export function setPronMiss(word: string, accent: Accent) {
  loadCache()
  const key = `${word}:${accent}`
  const cur = mem[key]
  if (cur?.miss && (cur.expire || 0) > Date.now()) return
  mem[key] = { miss: true, expire: Date.now() + MISS_TTL }
  scheduleSave()
}

/** 内存中短期标记 miss（同一个进程内不重复探测） */
const memMiss = new Map<string, number>()

export function isMemMiss(word: string, accent: Accent = 'UK'): boolean {
  const key = `${word}:${accent}`
  const e = memMiss.get(key)
  if (!e) return false
  if (Date.now() > e) { memMiss.delete(key); return false }
  return true
}

export function markMemMiss(word: string, accent: Accent = 'UK') {
  memMiss.set(`${word}:${accent}`, Date.now() + MISS_TTL_MEM)
}

/**
 * 探测一个词在音库是否存在。
 * 返回 true/false；网络异常时返回 null（不写缓存，留待重试）。
 */
export async function probeWord(word: string, accent: Accent = 'UK'): Promise<boolean | null> {
  const url = pronUrlOf(word, accent)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal })
    if (res.status === 200 || res.status === 206) return true
    if (res.status === 404) return false
    // 其它状态码（如 403/5xx）视为不确定
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 批量并发探测 */
export async function probeWords(words: string[], accent: Accent = 'UK', concurrency = 12): Promise<Record<string, boolean | null>> {
  const out: Record<string, boolean | null> = {}
  const queue = words.filter(w => !out[w])
  const workers: Promise<void>[] = []
  const run = async () => {
    while (queue.length) {
      const w = queue.shift()!
      out[w] = await probeWord(w, accent)
    }
  }
  for (let i = 0; i < Math.min(concurrency, Math.max(1, queue.length)); i++) workers.push(run())
  await Promise.all(workers)
  return out
}
