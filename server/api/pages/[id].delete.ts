import { runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400 })

  await runQuery('DELETE FROM knowledge_pages WHERE id=?', [id])
  return { ok: true }
})
