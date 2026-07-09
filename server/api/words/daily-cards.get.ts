import { queryAll, queryOne } from '../../utils/db'

const TYPE_TO_BOOK: Record<string, string> = {
  word: 'wb_default',
  phrase: 'wb_phrases',
  sentence: 'wb_sentences',
}

export default defineEventHandler(async (event) => {
  const date = getQuery(event).date as string
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw createError({ statusCode: 400, message: '需要 date 参数 (YYYY-MM-DD)' })
  }
  const filterType = (getQuery(event).type as string) || 'word'

  // 从 marks 表读取指定日期和类型的标记
  const rows = await queryAll(
    `SELECT DISTINCT text, type FROM marks
     WHERE date(createdAt) = ? AND type = ?
     ORDER BY text`,
    [date, filterType]
  )

  // 在 words 表中查找对应词条
  const result: any[] = []
  for (const row of rows) {
    const bookId = TYPE_TO_BOOK[row.type as string] || 'wb_default'
    const ws = await queryOne(
      'SELECT * FROM words WHERE bookId=? AND LOWER(word)=LOWER(?)',
      [bookId, (row.text as string).trim()]
    )
    if (ws) result.push(ws)
  }

  return { words: result, posCounts: {} }
})
