import { queryAll, queryOne } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const textId = getRouterParam(event, 'textId')
  if (!textId) throw createError({ statusCode: 400 })

  const type = (getQuery(event).type as string) || 'word'
  const bookIdMap: Record<string, string> = {
    word: 'wb_default',
    phrase: 'wb_phrases',
    sentence: 'wb_sentences',
  }
  const bookId = bookIdMap[type]
  if (!bookId) throw createError({ statusCode: 400, message: 'Invalid type' })

  // ── 单词列表（来自 words 表）──
  let words: any[]
  if (textId === '__orphan__') {
    words = await queryAll('SELECT * FROM words WHERE (source IS NULL OR source=?) AND bookId=? ORDER BY createdAt DESC', ['', bookId])
  } else {
    words = await queryAll('SELECT * FROM words WHERE source=? AND bookId=? ORDER BY createdAt DESC', [textId, bookId])
  }

  // ── 词性数量（来自 marks，与复习本一致）──
  const posIndex = new Map<string, string>()
  const posRows = await queryAll('SELECT LOWER(word) as w, pos FROM words WHERE pos IS NOT NULL AND pos != \'\'')
  for (const r of posRows) {
    if (!posIndex.has(r.w as string)) posIndex.set(r.w as string, r.pos as string)
  }

  const posCounts: Record<string, number> = {}
  const markRow = await queryOne(
    `SELECT marks FROM texts WHERE id=? AND marks IS NOT NULL AND marks != '' AND marks != '[]'`,
    [textId]
  )

  if (markRow) {
    let marks: any[] = []
    try { marks = JSON.parse(markRow.marks) } catch {}
    for (const m of marks) {
      if (!m.id || m.type !== type) continue
      const wordKey = (m.text || '').trim().toLowerCase()
      const pos = posIndex.get(wordKey) || ''
      const key = pos || '未标注'
      posCounts[key] = (posCounts[key] || 0) + 1
    }
  }

  return { words, posCounts }
})
