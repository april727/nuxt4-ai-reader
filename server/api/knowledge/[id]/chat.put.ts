import { runQuery } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ chatHistory: Array<{ role: string; content: string }> }>(event)
  if (!id) throw createError({ statusCode: 400, message: '缺少 ID' })

  await runQuery('UPDATE knowledge_points SET chatHistory=? WHERE id=?', [JSON.stringify(body.chatHistory || []), id])
  return { ok: true }
})
