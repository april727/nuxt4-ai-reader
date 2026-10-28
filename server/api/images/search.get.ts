/**
 * 图片候选搜索（自动配图）
 *
 * 提供商按配置依次尝试：
 *   1. PIXABAY_API_KEY   → Pixabay（免版权，免费 key，推荐）
 *   2. UNSPLASH_ACCESS_KEY → Unsplash
 *   3. 无密钥兜底        → Bing 图片（cn.bing.com，仅个人学习用途，版权未知）
 *
 * 只返回候选，不下载。用户点击确认后才由 /api/images/import 落盘，
 * 这样既能人工筛选，也能避免把不确定版权的图直接存进知识库。
 *
 * ── 关于「检索词被改写后图片完全不搭」──
 * Bing 对含歧义词的查询会**静默降级**：搜 `amazon warrior woman`（单数）返回的全是
 * 亚马逊电商 Logo，而 `amazon warrior women`（复数）才返回女战士。实测同域名下
 * 加引号、加限定词、换 mkt 都改不掉，只要写法触发它的实体识别就会回落到品牌结果。
 * 所以这里做三件事：
 *   1. 改写提示词禁止使用品牌/地名/影视名，让模型按语境描述画面而不是照抄词条；
 *   2. 一次给出 2 组候选检索词，逐个试；
 *   3. 用结果标题做相关性校验（剔除原词本身的 token），不合格就换下一组，
 *      全不合格时把最相关的一组标成 weak 返回，让前端如实提示。
 */
import { deepseekChat, isDeepSeekConfigured } from '../../utils/deepseek'
import { ACCEPT_SCORE, scoreResults } from '../../utils/imageRelevance'

interface Candidate {
  thumb: string
  full: string
  title?: string
  source: string
  page?: string
  license?: string
}

/* ────────────────────────── 检索词改写 ────────────────────────── */

const EXPAND_SYSTEM = [
  '你是图片搜索关键词助手。根据词条与语境，给出最多 2 组英文检索词，用来在图库中找一张能代表该词在此语境下含义的照片。',
  '规则：',
  '1) 每组 2-4 个英文单词，是可拍摄的具体画面、物体或场景，不要抽象概念、不要整句；',
  '2) 画面要体现「词条」本身；语境只用于判断它在这里取哪个义项，不要画成文章主题',
  '   （例：文章讲幼儿园，但词条是 amazons「女战士」，就该出女战士）；',
  '3) 禁止使用会撞上品牌名/公司名/地名/影视名的词（amazon、apple、windows、mars、shell 等）。',
  '   如果词条本身有歧义，就按语境含义描述画面，不要照抄词条；',
  '4) 每组都以一个具体名词开头；不要用 female、male、modern、beautiful、big 这类泛化形容词开头',
  '   （Bing 会只看第一个词，得到「female」就等于搜到「female 是什么意思」的词典页）；',
  '5) 可数名词用复数；',
  '6) 每行一组，按相关度从高到低排序，只输出检索词，不要编号、解释、引号。',
].join('\n')

/** 把词条改写成 1-3 组适合图库检索的画面短语（失败时退回原词） */
async function expandQueries(raw: string, context?: string): Promise<string[]> {
  if (!isDeepSeekConfigured()) return [raw]
  try {
    const out = await deepseekChat(
      [
        { role: 'system', content: EXPAND_SYSTEM },
        { role: 'user', content: `词条：${raw}${context ? `\n语境：${context.slice(0, 160)}` : ''}` },
      ],
      { temperature: 0.3, maxTokens: 64, timeoutMs: 8000 },
    )
    const lines = out
      .split('\n')
      .map(l => l.replace(/^\d+[.、)]\s*/, '').replace(/["'“”‘’。.,]/g, '').trim())
      .filter(Boolean)
      .map(l => l.slice(0, 60))
    const uniq = [...new Set(lines)].slice(0, 3)
    return uniq.length ? uniq : [raw]
  } catch {
    return [raw]
  }
}

/* ────────────────────────── 相关性校验 ────────────────────────── */

// 判定逻辑抽到 server/utils/imageRelevance.ts（纯函数，回归脚本可直接 import 测试）
/* ────────────────────────── 提供商 ────────────────────────── */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'

function dedupe(items: Candidate[], limit: number): Candidate[] {
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const it of items) {
    if (!it.thumb || !it.full || seen.has(it.full)) continue
    seen.add(it.full)
    out.push(it)
    if (out.length >= limit) break
  }
  return out
}

async function searchPixabay(q: string, count: number): Promise<Candidate[]> {
  const key = process.env.PIXABAY_API_KEY
  if (!key) return []
  const url = `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}`
    + `&image_type=photo&safesearch=true&per_page=${Math.min(count, 20)}&lang=en`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`pixabay ${res.status}`)
  const data = await res.json() as any
  return (data.hits || []).map((h: any): Candidate => ({
    thumb: h.webformatURL,
    full: h.largeImageURL || h.webformatURL,
    title: h.tags,
    source: 'Pixabay',
    page: h.pageURL,
    license: 'Pixabay Content License',
  }))
}

async function searchUnsplash(q: string, count: number): Promise<Candidate[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY
  if (!key) return []
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=${Math.min(count, 20)}`
  const res = await fetch(url, {
    headers: { Authorization: `Client-ID ${key}` },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`unsplash ${res.status}`)
  const data = await res.json() as any
  return (data.results || []).map((r: any): Candidate => ({
    thumb: r.urls?.small,
    full: r.urls?.regular || r.urls?.full,
    title: r.alt_description || r.description || '',
    source: `Unsplash / ${r.user?.name || 'unknown'}`,
    page: r.links?.html,
    license: 'Unsplash License',
  }))
}

/**
 * 解析 Bing 的 async 结果页。
 *
 * 每条结果都是一个 `<a class="iusc" m="{...json...}">`，json 里带 murl/turl/t/purl。
 * 早期实现是「按 murl 出现位置就近找 turl」，标题完全拿不到；改成解析这段 JSON 后
 * 既能配对准确，也能拿到标题用于相关性校验。
 */
function parseBingItems(html: string): Candidate[] {
  const out: Candidate[] = []
  const re = /class="iusc"[^>]*?m="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      const j = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')) as any
      const full = String(j.murl || '')
      if (!full) continue
      out.push({
        thumb: String(j.turl || full),
        full,
        title: String(j.t || ''),
        source: 'Bing 图片',
        page: String(j.purl || ''),
        license: '来源未知，建议仅个人学习使用',
      })
    } catch { /* 单条损坏就跳过 */ }
  }
  return out
}

async function fetchBing(q: string, count: number): Promise<string> {
  const url = `https://cn.bing.com/images/async?q=${encodeURIComponent(q)}&first=0&count=${Math.min(count * 2, 30)}&mmasync=1`
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': `https://cn.bing.com/images/search?q=${encodeURIComponent(q)}` },
    signal: AbortSignal.timeout(9000),
  })
  if (!res.ok) throw new Error(`bing ${res.status}`)
  return await res.text()
}

async function searchBing(q: string, count: number): Promise<Candidate[]> {
  // 注意：附加 qft 过滤参数时，Bing 会返回不含 turl（缩略图）的页面版本，故不加过滤条件
  let html = await fetchBing(q, count)
  let items = parseBingItems(html)
  // Bing 偶尔回一个极短的空壳页或只剩一两条的残页（限流），换一次再试
  if (items.length < 3 && html.length < 60_000) {
    await new Promise(r => setTimeout(r, 500))
    html = await fetchBing(q, count)
    items = parseBingItems(html)
  }
  return items
}

/* ────────────────────────── 入口 ────────────────────────── */

export default defineEventHandler(async (event) => {
  const raw = String(getQuery(event).q || '').trim()
  if (!raw) throw createError({ statusCode: 400, message: '缺少搜索关键词' })
  const count = Math.min(Math.max(Number(getQuery(event).count) || 12, 1), 20)
  const context = String(getQuery(event).context || '').slice(0, 300)
  const smart = getQuery(event).expand === '1'

  const providers: Array<{ name: string; run: (q: string, n: number) => Promise<Candidate[]> }> = []
  if (process.env.PIXABAY_API_KEY) providers.push({ name: 'pixabay', run: searchPixabay })
  if (process.env.UNSPLASH_ACCESS_KEY) providers.push({ name: 'unsplash', run: searchUnsplash })
  providers.push({ name: 'bing', run: searchBing })

  // 手动输入的检索词按字面搜，不改写、不校验（用户自己知道要什么）
  const queries = smart ? await expandQueries(raw, context) : [raw]
  const errors: string[] = []
  const tried: Array<{ query: string; hits: number; score: number; junk?: number }> = []
  let best: { provider: string; query: string; candidates: Candidate[]; score: number } | null = null

  for (const query of queries) {
    for (const p of providers) {
      let candidates: Candidate[] = []
      try {
        candidates = dedupe(await p.run(query, count), count)
      } catch (e: any) {
        errors.push(`${p.name}: ${e.message}`)
        continue
      }
      if (!candidates.length) continue
      const judged = smart ? scoreResults(query, raw, candidates) : { score: 1, junk: 0 }
      const score = judged.score
      tried.push({ query, hits: candidates.length, score, junk: judged.junk })
      if (!best || score > best.score) best = { provider: p.name, query, candidates, score }
      if (score >= ACCEPT_SCORE) {
        // 命中足够相关的第一组就直接返回，不再消耗后续请求
        return { provider: p.name, query, original: raw, candidates, score, tried }
      }
    }
  }

  // 只剩一两条时多半是 Bing 返回的残页，拿来配图只会更误导，直接当作没搜到
  if (best && best.candidates.length >= 2) {
    return {
      provider: best.provider,
      query: best.query,
      original: raw,
      candidates: best.candidates,
      score: best.score,
      // 相关性不足：仍把图给出去，但如实标记，前端提示「可换关键词 / 用原词搜」
      weak: best.score < ACCEPT_SCORE,
      tried,
    }
  }

  return {
    provider: 'none',
    query: queries[0] || raw,
    original: raw,
    candidates: [] as Candidate[],
    tried,
    error: errors.length ? `图片源不可用（${errors.join('；')}）` : '没有找到合适的图片，可换关键词或直接粘贴图片',
  }
})
