import { queryAll } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const textId = getRouterParam(event, 'textId')
  if (!textId) throw createError({ statusCode: 400 })

  const type = getQuery(event).type || 'word'
  const bookIdMap: Record<string, string> = {
    word: 'wb_default',
    phrase: 'wb_phrases',
    sentence: 'wb_sentences',
  }
  const bookId = bookIdMap[type as string]
  if (!bookId) throw createError({ statusCode: 400, message: 'Invalid type' })

  if (textId === '__orphan__') {
    return await queryAll(
      'SELECT * FROM words WHERE (source IS NULL OR source=?) AND bookId=? ORDER BY createdAt DESC',
      ['', bookId]
    )
  }
  return await queryAll(
    'SELECT * FROM words WHERE source=? AND bookId=? ORDER BY createdAt DESC',
    [textId, bookId]
  )
})
