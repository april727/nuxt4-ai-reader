import { queryAll } from '../../utils/db'

const TYPE_COLORS: Record<string, string> = {
  word: '#f59e0b',
  phrase: '#10b981',
  sentence: '#06b6d4',
  note: '#f9a8d4',
}

export default defineEventHandler(async (event) => {
  const date = getQuery(event).date as string
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw createError({ statusCode: 400, message: '需要 date 参数 (YYYY-MM-DD)' })
  }

  // 从 words 表加载词性索引
  const posIndex = new Map<string, string>()
  const posRows = await queryAll('SELECT LOWER(word) as w, pos FROM words WHERE pos IS NOT NULL AND pos != \'\'')
  for (const r of posRows) {
    if (!posIndex.has(r.w as string)) posIndex.set(r.w as string, r.pos as string)
  }

  // 从 marks 表读取指定日期的标记
  const rows = await queryAll(
    'SELECT * FROM marks WHERE date(createdAt) = ? ORDER BY createdAt DESC',
    [date]
  )

  const marks = rows.map((row: any) => {
    const pos = posIndex.get((row.text || '').trim().toLowerCase()) || ''
    const phonetic = row.detail
      ? (row.detail.match(/\[PHONETIC\]\s*(\/[^/]+\/)\s*\[\/PHONETIC\]/) || [])[1] || ''
      : ''
    return {
      id: row.id,
      text: row.text || '',
      type: row.type || 'word',
      color: TYPE_COLORS[row.type] || '#a09e97',
      pos,
      detail: row.detail || '',
      textId: row.textId,
      textTitle: row.textTitle,
      phonetic,
      brief: extractBrief(row.detail || ''),
    }
  })

  const wordMarks = marks.filter(m => m.type === 'word')
  const posCounts: Record<string, number> = {}
  for (const m of wordMarks) {
    const key = m.pos || '未标注'
    posCounts[key] = (posCounts[key] || 0) + 1
  }

  return {
    date,
    total: marks.length,
    wordCount: wordMarks.length,
    phraseCount: marks.filter(m => m.type === 'phrase').length,
    sentenceCount: marks.filter(m => m.type === 'sentence').length,
    posCounts,
    words: wordMarks.map(m => m.text).filter((v, i, a) => a.indexOf(v) === i),
    marks,
  }
})

function extractBrief(detail: string): string {
  if (!detail) return ''
  return detail.replace(/\[PHONETIC\].*?\[\/PHONETIC\]/g, '')
    .replace(/[#*|`]/g, '').replace(/\n+/g, ' ').trim().slice(0, 120)
}
