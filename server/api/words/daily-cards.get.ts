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

  // 从所有 texts 的 marks 中找出当日标记的单词文本
  const markEntries: Array<{ text: string; type: string }> = []
  const rows = await queryAll(
    `SELECT marks FROM texts WHERE marks IS NOT NULL AND marks != '' AND marks != '[]'`
  )
  for (const row of rows) {
    let marks: any[] = []
    try { marks = JSON.parse(row.marks) } catch { continue }
    for (const m of marks) {
      if (!m.id || !m.createdAt) continue
      if ((m.createdAt as string).slice(0, 10) !== date) continue
      const mType = m.type || 'word'
      if (filterType && mType !== filterType) continue
      markEntries.push({ text: (m.text || '').trim(), type: mType })
    }
  }

  // 在 words 表中查找对应词条（带 SM-2 状态），去重
  const result: any[] = []
  const seen = new Set<string>()
  for (const me of markEntries) {
    const bookId = TYPE_TO_BOOK[me.type] || 'wb_default'
    const key = `${bookId}:${me.text.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)

    const ws = await queryOne('SELECT * FROM words WHERE bookId=? AND LOWER(word)=LOWER(?)', [bookId, me.text])
    if (ws) {
      result.push(ws)
    }
  }

  return { words: result, posCounts: {} }
})
