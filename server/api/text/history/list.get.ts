import { listTextHistory } from '../../../utils/textHistory'

/**
 * GET /api/text/history/list?id=xxx
 * 列出某篇文章的段落结构历史（快照列表）
 */
export default defineEventHandler(async (event) => {
  const id = getQuery(event).id as string
  if (!id) throw createError({ statusCode: 400, message: '缺少 id' })
  const items = await listTextHistory(id)
  return { items }
})
