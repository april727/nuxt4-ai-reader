import { runQuery, queryOne } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  const wordId = getRouterParam(event, 'wordId')
  if (!bookId || !wordId) throw createError({ statusCode: 400 })

  const word = await queryOne('SELECT id FROM words WHERE id=? AND bookId=?', [wordId, bookId])
  if (!word) throw createError({ statusCode: 404, message: '单词不存在' })

  await runQuery('DELETE FROM words WHERE id=? AND bookId=?', [wordId, bookId])

  return { ok: true }
})
