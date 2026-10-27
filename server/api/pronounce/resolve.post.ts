/**
 * POST /api/pronounce/resolve
 * 批量解析单词发音地址。
 *
 * 请求：{ words: string[], accent?: 'UK' | 'US' }
 * 响应：{ results: { [word]: { url: string, via: string } | null } }
 *
 * 服务端直连音库（无 CORS 限制），结果落盘缓存，命中即返回。
 * 词形还原逻辑与前端共用 shared/utils/pronounce，保证口径一致。
 *
 * ============ 性能设计 ============
 * 旧做法是「一个词一个词串行试候选」：变形词要试 2~3 个候选原形，
 * 每个 ~700ms 往返，400 词就要十几秒。
 *
 * 现在改成**两阶段全并行**：
 *   阶段 A：把所有需要查的词（原形 + 所有候选原形）汇总去重，铺平成一个大列表
 *   阶段 B：这个大列表用高并发一次性探测完
 *   阶段 C：按优先级（自己的原形 > 候选1 > 候选2 …）回填每个词的结果
 * 这样无论一个词有几个候选，延迟都只取决于一轮网络往返。
 */
import { pronCandidates } from '../../../shared/utils/pronounce'
import {
  getPronEntry, setPronCached, setPronMiss, isMemMiss, markMemMiss,
  pronUrlOf, probeWord,
} from '../../utils/pronounce'

/** 并发探测数：音库是 CDN，20 并发稳定且快 */
const CONCURRENCY = 20

export default defineEventHandler(async (event) => {
  const body = await readBody<{ words?: string[]; accent?: 'UK' | 'US' }>(event)
  const accent = body?.accent === 'US' ? 'US' : 'UK'
  const rawWords = Array.isArray(body?.words) ? body.words : []

  // 去重 + 清洗（只保留小写字母词，最多 500 个）
  const words: string[] = []
  for (const w of rawWords) {
    const s = String(w || '').toLowerCase().trim()
    if (!s || s.length > 40) continue
    if (!/^[a-z][a-z'-]*$/.test(s)) continue
    if (!words.includes(s)) words.push(s)
    if (words.length >= 500) break
  }
  if (!words.length) return { results: {} }

  const results: Record<string, { url: string; via: string } | null> = {}

  /* ---------- 阶段 A：汇总所有待查词 ---------- */

  /** 每个词的候选优先级列表：自己的原形排第一 */
  const plan = new Map<string, string[]>()
  /** 所有需要探测的词（去重后的全集） */
  const allToProbe = new Set<string>()

  for (const w of words) {
    // 缓存命中 → 直接出结果，不再探测
    const entry = getPronEntry(w, accent)
    if (entry) { results[w] = { url: entry.url, via: entry.via }; continue }
    // 明确无音（之前查过，所有候选都 404）→ 直接 null
    if (isMemMiss(w, accent)) { results[w] = null; continue }

    // 该词自己 + 它的候选原形，按优先级排列
    const chain = [w, ...pronCandidates(w)]
    plan.set(w, chain)
    for (const c of chain) {
      if (getPronEntry(c, accent)) continue // 候选已在缓存里
      if (isMemMiss(c, accent)) continue    // 候选明确无音
      allToProbe.add(c)
    }
  }

  /* ---------- 阶段 B：全并行探测 ---------- */

  const probeList = Array.from(allToProbe)
  const probed = new Map<string, boolean | null>()
  if (probeList.length) {
    let idx = 0
    const workers: Promise<void>[] = []
    const run = async () => {
      while (idx < probeList.length) {
        const w = probeList[idx++]
        probed.set(w, await probeWord(w, accent))
      }
    }
    for (let i = 0; i < Math.min(CONCURRENCY, probeList.length); i++) workers.push(run())
    await Promise.all(workers)
  }

  // 写缓存：命中的记 url，明确 404 的记 miss
  for (const [w, ok] of probed) {
    if (ok === true) {
      setPronCached(w, accent, pronUrlOf(w, accent), w)
    } else if (ok === false) {
      setPronMiss(w, accent)
      markMemMiss(w, accent)
    }
    // ok === null（网络不确定）→ 不写缓存，留待重试
  }

  /* ---------- 阶段 C：按优先级回填 ---------- */

  for (const [w, chain] of plan) {
    let found: { url: string; via: string } | null = null
    for (const c of chain) {
      // 优先用刚探测到的结果
      const ok = probed.get(c)
      if (ok === true) { found = { url: pronUrlOf(c, accent), via: c }; break }
      if (ok === false) continue
      // 没探测过（已在缓存里，或已 miss）→ 查缓存
      const entry = getPronEntry(c, accent)
      if (entry) { found = { url: entry.url, via: entry.via }; break }
    }
    if (found) {
      results[w] = found
      // 变形词的解析结果也缓存下来，下次直接命中（catches → catch.mp3）
      if (found.via !== w) setPronCached(w, accent, found.url, found.via)
    } else {
      results[w] = null
      // 整条链（含所有候选）都查过且都没有 → 标记该词无音
      const chainAllMissed = chain.every(c => isMemMiss(c, accent) || probed.get(c) === false)
      if (chainAllMissed) { setPronMiss(w, accent); markMemMiss(w, accent) }
    }
  }

  return { results }
})
