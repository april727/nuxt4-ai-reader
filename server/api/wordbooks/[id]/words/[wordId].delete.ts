import { runQuery, queryOne } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  const wordId = getRouterParam(event, 'wordId')
  if (!bookId || !wordId) throw createError({ statusCode: 400 })

  const word = await queryOne('SELECT id FROM words WHERE id=? AND bookId=?', [wordId, bookId])
  if (!word) throw createError({ statusCode: 404, message: '单词不存在' })

  // 只从单词本移除（墓碑），不删除标记。
  // 保留行是为了让同步层知道「用户主动移除过」，避免下次标记变化时词条又冒出来。
  const now = new Date().toISOString()
  await runQuery('UPDATE words SET dismissedAt=?, updatedAt=? WHERE id=? AND bookId=?', [now, now, wordId, bookId])

  return { ok: true, dismissed: true }
})
