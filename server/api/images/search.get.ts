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
 */
import { deepseekChat, isDeepSeekConfigured } from '../../utils/deepseek'

interface Candidate {
  thumb: string
  full: string
  title?: string
  source: string
  page?: string
  license?: string
}

/**
 * 把词条改写成适合图库检索的画面短语。
 * 单词直接搜（如 "abandon"）容易命中词典截图、视频封面，
 * 改写成 "abandoned building" 这类 2–4 词短语后相关性明显提升。
 */
async function expandQuery(q: string, context?: string): Promise<string> {
  if (!isDeepSeekConfigured()) return q
  try {
    const out = await deepseekChat(
      [
        { role: 'system', content: '你是图片搜索关键词助手。把用户给出的词条改写成一个 2-4 个英文单词、具体可拍摄的画面描述，适合在图库中检索。只输出关键词本身，不要解释、不要引号、不要标点。' },
        { role: 'user', content: `词条：${q}${context ? `\n语境：${context.slice(0, 160)}` : ''}` },
      ],
      { temperature: 0.3, maxTokens: 24, timeoutMs: 8000 },
    )
    const cleaned = out.trim().split('\n')[0].replace(/["'“”‘’。.]/g, '').slice(0, 60).trim()
    return cleaned || q
  } catch {
    return q
  }
}

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

/** 在 murl 附近找最近的缩略图地址（Bing 结果里 turl 与 murl 顺序不固定） */
function nearestThumb(html: string, idx: number): string {
  const from = Math.max(0, idx - 1200)
  const to = Math.min(html.length, idx + 1200)
  const window = html.slice(from, to)
  const re = /turl&quot;:&quot;(https?:[^&]*?)&quot;/g
  let best = ''
  let bestDist = Infinity
  let m: RegExpExecArray | null
  while ((m = re.exec(window)) !== null) {
    if (!m[1]) continue
    const abs = from + m.index
    const dist = Math.abs(abs - idx)
    if (dist < bestDist) { bestDist = dist; best = m[1] }
  }
  return best
}

async function searchBing(q: string, count: number): Promise<Candidate[]> {
  // 注意：附加 qft 过滤参数时，Bing 会返回不含 turl（缩略图）的页面版本，
  // 因此这里不加过滤条件，缩略图缺失时退回原图地址。
  const url = `https://cn.bing.com/images/async?q=${encodeURIComponent(q)}&first=0&count=${Math.min(count * 2, 30)}&mmasync=1`
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': `https://cn.bing.com/images/search?q=${encodeURIComponent(q)}` },
    signal: AbortSignal.timeout(9000),
  })
  if (!res.ok) throw new Error(`bing ${res.status}`)
  const html = await res.text()

  const items: Candidate[] = []
  const re = /murl&quot;:&quot;(https?:[^&]*?)&quot;/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const full = m[1].replace(/&amp;/g, '&')
    const thumb = (nearestThumb(html, m.index) || full).replace(/&amp;/g, '&')
    items.push({
      thumb,
      full,
      source: 'Bing 图片',
      license: '来源未知，建议仅个人学习使用',
    })
  }
  return items
}

export default defineEventHandler(async (event) => {
  const raw = String(getQuery(event).q || '').trim()
  if (!raw) throw createError({ statusCode: 400, message: '缺少搜索关键词' })
  const count = Math.min(Math.max(Number(getQuery(event).count) || 12, 1), 20)
  const context = String(getQuery(event).context || '').slice(0, 300)
  const query = getQuery(event).expand === '1' ? await expandQuery(raw, context) : raw

  const providers: Array<{ name: string; run: (q: string, n: number) => Promise<Candidate[]> }> = []
  if (process.env.PIXABAY_API_KEY) providers.push({ name: 'pixabay', run: searchPixabay })
  if (process.env.UNSPLASH_ACCESS_KEY) providers.push({ name: 'unsplash', run: searchUnsplash })
  providers.push({ name: 'bing', run: searchBing })

  const errors: string[] = []
  for (const p of providers) {
    try {
      const candidates = dedupe(await p.run(query, count), count)
      if (candidates.length) {
        return { provider: p.name, query, original: raw, candidates }
      }
    } catch (e: any) {
      errors.push(`${p.name}: ${e.message}`)
    }
  }

  return {
    provider: 'none',
    query,
    original: raw,
    candidates: [],
    error: errors.length ? `图片源不可用（${errors.join('；')}）` : '没有找到合适的图片，可换关键词或直接粘贴图片',
  }
})
