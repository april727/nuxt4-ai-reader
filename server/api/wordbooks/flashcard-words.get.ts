import { queryAll, queryOne } from '../../utils/db'

const TYPE_TO_BOOK: Record<string, string> = {
  word: 'wb_default',
  phrase: 'wb_phrases',
  sentence: 'wb_sentences',
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const type = (query.type as string) || 'word'
  const bookId = query.bookId as string | undefined
  const dailyDate = query.dailyDate as string | undefined

  // ── 每日单词入口：从 marks 表读取指定日期的单词 ──
  if (dailyDate && /^\d{4}-\d{2}-\d{2}$/.test(dailyDate)) {
    const dailyType = (query.dailyType as string) || type
    const rows = await queryAll(
      `SELECT DISTINCT text, type FROM marks
       WHERE date(createdAt) = ? AND type = ?
       ORDER BY text`,
      [dailyDate, dailyType]
    )

    const result: any[] = []
    for (const row of rows) {
      const targetBook = TYPE_TO_BOOK[row.type as string] || 'wb_default'
      const w = await queryOne(
        'SELECT * FROM words WHERE bookId=? AND LOWER(word)=LOWER(?)',
        [targetBook, (row.text as string).trim()]
      )
      if (w) result.push({ ...w, cardType: row.type })
    }
    return { words: result }
  }

  // ── 指定单词本入口：按 bookId（+ 可选 source）过滤 ──
  if (bookId) {
    const source = query.source as string | undefined

    const inferredType =
      bookId === 'wb_default' ? 'word' :
      bookId === 'wb_phrases' ? 'phrase' :
      bookId === 'wb_sentences' ? 'sentence' :
      type

    if (source && source !== '__orphan__') {
      // 从特定文本/书籍进入时，按 source + bookId 双重过滤
      const words = await queryAll(
        'SELECT * FROM words WHERE source=? AND bookId=? AND phase != ? ORDER BY createdAt DESC',
        [source, bookId, 'mastered']
      )
      return { words: words.map(w => ({ ...w, cardType: w.cardType || inferredType })) }
    }

    const words = await queryAll(
      'SELECT * FROM words WHERE bookId=? AND phase != ? ORDER BY createdAt DESC',
      [bookId, 'mastered']
    )
    return { words: words.map(w => ({ ...w, cardType: w.cardType || inferredType })) }
  }

  // ── 兜底：按 type 映射到默认单词本 ──
  if (type === 'mixed') {
    const words = await queryAll(
      `SELECT *, 'word' as cardType FROM words WHERE bookId='wb_default' AND phase != 'mastered'
       UNION ALL
       SELECT *, 'phrase' as cardType FROM words WHERE bookId='wb_phrases' AND phase != 'mastered'
       UNION ALL
       SELECT *, 'sentence' as cardType FROM words WHERE bookId='wb_sentences' AND phase != 'mastered'
       ORDER BY createdAt DESC`
    )
    return { words }
  }

  const defaultBookId = TYPE_TO_BOOK[type]
  if (!defaultBookId) throw createError({ statusCode: 400, message: 'Invalid type' })

  const words = await queryAll(
    'SELECT * FROM words WHERE bookId=? AND phase != ? ORDER BY createdAt DESC',
    [defaultBookId, 'mastered']
  )
  return { words: words.map(w => ({ ...w, cardType: type })) }
})
