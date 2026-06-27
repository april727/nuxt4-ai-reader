import { runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ items: Array<{ id: string; sortOrder: number }> }>(event)
  if (!body?.items?.length) throw createError({ statusCode: 400, message: '缺少排序数据' })

  for (const item of body.items) {
    await runQuery('UPDATE knowledge_points SET sortOrder=? WHERE id=?', [item.sortOrder, item.id])
  }

  return { ok: true }
})
