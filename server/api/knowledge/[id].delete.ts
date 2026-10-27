import { runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: '缺少 ID' })

  await runQuery('DELETE FROM knowledge_points WHERE id=?', [id])

  return { ok: true }
})
