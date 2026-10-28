/**
 * 配图检索的相关性判定（纯函数，零依赖 —— 方便脚本直接测）
 *
 * 背景：Bing 在中文市场搜英文多词查询时会「只看第一个词」，并且对含歧义词的查询
 * 静默回落到品牌实体。实测：
 *   `amazon warrior woman`  → 全是亚马逊电商 Logo
 *   `amazon warrior women`  → 才是女战士
 *   `female warrior women`  → 全是「female（英文单词）_百度百科」
 *   `muscle tension back pain` → 全是 muscle coloring pages
 * 所以检索结果必须自己判一遍，判不过就换一组检索词，再判不过就如实标记「相关度低」。
 */

/** 不参与判别的虚词与通用词 */
const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'with', 'and', 'at', 'to', 'for', 'by', 'from', 'photo', 'image', 'picture'])

/**
 * 词典/百科类结果的特征词。
 *
 * Bing 经常把「英文单词」的百科条目当图片结果返回，这类图对配图毫无意义，
 * 必须显式识别出来，否则单看 token 命中率它们反而是满分的。
 */
const JUNK = /百科|词典|英文单词|释义|翻译|怎么读|音标|读音|dictionary|definition|meaning|translation|pronunciation|wiki|vocabulary/i

export interface ScoredItem {
  title?: string
}

export interface ScoreDetail {
  score: number
  coverage: number
  junk: number
  distinct?: number
  judged: boolean
}

/**
 * 检索词里「有判别力」的 token：去掉停用词，再去掉落在原词里的那些。
 *
 * 为什么必须剔原词：搜 `amazon warrior woman` 时结果标题全是「Amazon亚马逊-店小秘」，
 * 若把 amazon 计入匹配，这堆电商图会被判成「相关」。
 */
export function signalTokens(query: string, raw: string): string[] {
  const rawLower = raw.toLowerCase().replace(/[^a-z0-9\s-]/g, '')
  const rawWords = new Set(rawLower.split(/\s+/).filter(Boolean))
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOP.has(t) && !rawWords.has(t) && !rawLower.includes(t))
}

/**
 * 相关性打分，取值 0~1：
 *   coverage = 标题命中判别 token 的比例
 *   junk     = 词典/百科类结果占比
 *   distinct = 一共命中了几个不同的 token
 *
 * 只命中一个 token 时打 0.55 折 —— `muscle tension back pain` 的标题里确实都有 muscle，
 * coverage 满分，但图像全是肌肉涂色页，不能算相关。打折后够不到 0.6 的采信线。
 */
export function scoreResults(query: string, raw: string, items: ScoredItem[]): ScoreDetail {
  const toks = signalTokens(query, raw)
  const titles = items.map(i => i.title || '').filter(Boolean)
  // 标题太少就无法判断相关性 —— 给个中间分：不直接采信，也不至于压过别组
  if (!toks.length || titles.length < 2) return { score: toks.length ? 0.5 : 1, coverage: 0, junk: 0, judged: false }

  let hit = 0
  let junk = 0
  const matched = new Set<string>()
  for (const t of titles) {
    const lower = t.toLowerCase()
    const inThis = toks.filter(k => lower.includes(k))
    if (inThis.length) hit++
    for (const k of inThis) matched.add(k)
    if (JUNK.test(t)) junk++
  }
  const coverage = hit / titles.length
  const junkRatio = junk / titles.length
  const damp = matched.size >= 2 ? 1 : 0.55
  return {
    score: Number((coverage * (1 - junkRatio) * damp).toFixed(2)),
    coverage: Number(coverage.toFixed(2)),
    junk: Number(junkRatio.toFixed(2)),
    distinct: matched.size,
    judged: true,
  }
}

/** 采信线：低于它的结果仍可展示，但要标记 weak */
export const ACCEPT_SCORE = 0.6
