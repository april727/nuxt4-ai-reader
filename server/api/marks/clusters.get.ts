import { supabaseQuery } from '../../utils/supabase'

interface MarkRow {
  display_text: string
  type: string
  mark_count: number
  embedding: number[]
}

/** 余弦相似度 */
function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const norm = Math.sqrt(na) * Math.sqrt(nb)
  return norm === 0 ? 0 : dot / norm
}

/** 贪心阈值聚类：每个向量与已有组质心比较，相似度 >= threshold 则归入，否则新建组 */
function greedyCluster(rows: MarkRow[], threshold: number): MarkRow[][] {
  const clusters: { centroid: number[]; count: number; items: MarkRow[] }[] = []
  for (const row of rows) {
    let best = -1
    let bestSim = threshold
    for (let ci = 0; ci < clusters.length; ci++) {
      const sim = cosine(row.embedding, clusters[ci].centroid)
      if (sim > bestSim) {
        bestSim = sim
        best = ci
      }
    }
    if (best >= 0) {
      const c = clusters[best]
      c.items.push(row)
      // 移动平均更新质心
      const n = c.count + 1
      for (let i = 0; i < c.centroid.length; i++) {
        c.centroid[i] = (c.centroid[i] * c.count + row.embedding[i]) / n
      }
      c.count = n
    } else {
      clusters.push({ centroid: [...row.embedding], count: 1, items: [row] })
    }
  }
  return clusters.map((c) => c.items)
}

// 简单内存缓存，避免每次请求都拉全量向量 + 聚类
const cache = new Map<string, { ts: number; data: any }>()
const CACHE_TTL = 300_000 // 5 分钟

/**
 * GET /api/marks/clusters?threshold=0.7&type=word&minCount=2
 * 标记内容按语义向量聚合成组。
 * minCount：只聚类标记次数 >= 该值的重点内容，默认 2（减少传输量、加快速度）。
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const threshold = Number(query.threshold || 0.7)
  const type = typeof query.type === 'string' && query.type !== 'all' ? query.type : ''
  const minCount = Math.max(1, Number(query.minCount || 2))
  const cacheKey = `${threshold}:${type}:${minCount}`

  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    return hit.data
  }

  try {
    // 分页拉取向量（仅标记次数 >= minCount 的重点内容）
    const allRows: MarkRow[] = []
    const pageSize = 500
    let offset = 0
    for (;;) {
      const params: Record<string, string> = {
        select: 'display_text,type,mark_count,embedding',
        limit: String(pageSize),
        offset: String(offset),
        order: 'mark_count.desc',
      }
      if (type) params['type'] = `eq.${type}`
      params['mark_count'] = `gte.${minCount}`
      const rows = await supabaseQuery<MarkRow[]>('marks_embeddings', params)
      allRows.push(...rows)
      if (rows.length < pageSize) break
      offset += pageSize
    }

    if (!allRows.length) {
      return { clusters: [], total: 0, threshold, minCount }
    }

    const rawClusters = greedyCluster(allRows, threshold)
    const clusters = rawClusters
      .sort((a, b) => b.length - a.length)
      .map((c, idx) => {
        // 只返回展示字段，剥离 embedding 省带宽
        const items = c.map((r) => ({
          display_text: r.display_text,
          type: r.type,
          mark_count: r.mark_count,
        }))
        const totalMarks = items.reduce((s, i) => s + i.mark_count, 0)
        return {
          id: idx,
          size: items.length,
          totalMarks,
          // 用标记次数最高的词作为代表
          label: items.reduce((a, b) => (b.mark_count > a.mark_count ? b : a)).display_text,
          items,
        }
      })

    const data = { clusters, total: allRows.length, threshold, minCount }
    cache.set(cacheKey, { ts: Date.now(), data })
    return data
  } catch (e: any) {
    console.error('[marks/clusters] Supabase 查询失败:', e.message)
    throw createError({ statusCode: 502, message: '向量库查询失败，请确认 SUPABASE 配置' })
  }
})
