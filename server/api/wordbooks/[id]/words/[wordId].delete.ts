import { runQuery } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  const wordId = getRouterParam(event, 'wordId')
  if (!bookId || !wordId) throw createError({ statusCode: 400 })

  await runQuery('DELETE FROM words WHERE id=? AND bookId=?', [wordId, bookId])
  return { ok: true }
})
