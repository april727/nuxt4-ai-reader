import { runQuery } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  const { wordIds, toBookId } = await readBody<{ wordIds: string[]; toBookId: string }>(event)
  if (!bookId || !toBookId || !wordIds?.length) throw createError({ statusCode: 400 })

  for (const wid of wordIds) {
    await runQuery('UPDATE words SET bookId=? WHERE id=? AND bookId=?', [toBookId, wid, bookId])
  }
  return { ok: true }
})
