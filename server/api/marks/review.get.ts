import { supabaseQuery } from '../../utils/supabase'

interface MarkEmbedRow {
  display_text: string
  type: string
  mark_count: number
}

/**
 * GET /api/marks/review
 * 标记内容按"标记次数"从高到低返回（难点词）。
 * 数据来自 Supabase marks_embeddings（回填脚本已统计 mark_count）。
 * query: ?type=word|phrase|sentence&limit=300
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const type = typeof query.type === 'string' ? query.type : ''
  const limit = Math.min(Number(query.limit) || 300, 1000)

  const params: Record<string, string> = {
    select: 'display_text,type,mark_count',
    order: 'mark_count.desc',
    limit: String(limit),
  }
  if (type) params['type'] = `eq.${type}`

  try {
    const rows = await supabaseQuery<MarkEmbedRow[]>('marks_embeddings', params)
    return { items: rows, total: rows.length }
  } catch (e: any) {
    console.error('[marks/review] Supabase 查询失败:', e.message)
    throw createError({ statusCode: 502, message: '向量库查询失败，请确认 SUPABASE 配置' })
  }
})
