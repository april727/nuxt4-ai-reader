import { getDb, saveDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  const wordId = getRouterParam(event, 'wordId')
  if (!bookId || !wordId) throw createError({ statusCode: 400 })

  const db = await getDb()
  db.run('DELETE FROM words WHERE id=? AND bookId=?', [wordId, bookId])
  await saveDb()
  return { ok: true }
})
