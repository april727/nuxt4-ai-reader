import { queryAll } from '../../../utils/db'

// bookId → mark type 映射
const BOOK_TO_TYPE: Record<string, string> = {
  wb_default: 'word',
  wb_phrases: 'phrase',
  wb_sentences: 'sentence',
}

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  if (!bookId) throw createError({ statusCode: 400 })

  // ── 单词列表（来自 words 表）──
  const rows = await queryAll('SELECT * FROM words WHERE bookId=? ORDER BY createdAt DESC', [bookId])

  // ── 词性数量（来自 marks，与复习本一致）──
  const markType = BOOK_TO_TYPE[bookId]
  const posCounts: Record<string, number> = {}

  if (markType) {
    // 预加载 words 表的 pos 索引
    const posIndex = new Map<string, string>()
    const posRows = await queryAll('SELECT LOWER(word) as w, pos FROM words WHERE pos IS NOT NULL AND pos != \'\'')
    for (const r of posRows) {
      if (!posIndex.has(r.w as string)) posIndex.set(r.w as string, r.pos as string)
    }

    // 扫描 marks 中对应类型的标记，统计词性
    const marksRows = await queryAll(
      `SELECT marks FROM texts WHERE marks IS NOT NULL AND marks != '' AND marks != '[]'`
    )
    for (const row of marksRows) {
      let marks: any[] = []
      try { marks = JSON.parse(row.marks) } catch { continue }
      for (const m of marks) {
        if (!m.id || m.type !== markType) continue
        const wordKey = (m.text || '').trim().toLowerCase()
        const pos = posIndex.get(wordKey) || ''
        const key = pos || '未标注'
        posCounts[key] = (posCounts[key] || 0) + 1
      }
    }
  }

  return { words: rows, posCounts }
})
