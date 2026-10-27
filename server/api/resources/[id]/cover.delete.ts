import { runQuery } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const textId = getRouterParam(event, 'id')
  if (!textId) throw createError({ statusCode: 400, message: '缺少资源 id' })

  await runQuery('UPDATE texts SET cover=?, updatedAt=? WHERE id=?', ['', new Date().toISOString(), textId])
  return { ok: true }
})
