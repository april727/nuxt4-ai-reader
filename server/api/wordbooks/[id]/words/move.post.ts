import { getDb, saveDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  const { wordIds, toBookId } = await readBody<{ wordIds: string[]; toBookId: string }>(event)
  if (!bookId || !toBookId || !wordIds?.length) throw createError({ statusCode: 400 })

  const db = await getDb()
  for (const wid of wordIds) {
    db.run('UPDATE words SET bookId=? WHERE id=? AND bookId=?', [toBookId, wid, bookId])
  }
  await saveDb()
  return { ok: true }
})
