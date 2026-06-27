import { queryAll } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const date = getQuery(event).date as string
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw createError({ statusCode: 400, message: '需要 date 参数 (YYYY-MM-DD)' })
  }

  // 预加载 words 表的 pos 索引
  const posIndex = new Map<string, string>()
  const posRows = await queryAll('SELECT LOWER(word) as w, pos FROM words WHERE pos IS NOT NULL AND pos != \'\'')
  for (const r of posRows) {
    if (!posIndex.has(r.w as string)) posIndex.set(r.w as string, r.pos as string)
  }

  const textRows = await queryAll(
    `SELECT id, title, marks FROM texts WHERE marks IS NOT NULL AND marks != '' AND marks != '[]'`
  )

  const marks: Array<{
    id: string
    text: string
    type: string
    pos: string
    detail: string
    textId: string
    textTitle: string
    phonetic: string
    brief: string
  }> = []

  for (const row of textRows) {
    let rawMarks: any[] = []
    try { rawMarks = JSON.parse(row.marks) } catch { continue }

    for (const m of rawMarks) {
      if (!m.id || !m.createdAt) continue
      if ((m.createdAt as string).slice(0, 10) !== date) continue

      const pos = posIndex.get((m.text || '').trim().toLowerCase()) || ''
      const phonetic = m.detail
        ? (m.detail.match(/\[PHONETIC\]\s*(\/[^/]+\/)\s*\[\/PHONETIC\]/) || [])[1] || ''
        : ''

      marks.push({
        id: m.id,
        text: m.text || '',
        type: m.type || 'word',
        pos,
        detail: m.detail || '',
        textId: row.id as string,
        textTitle: row.title as string,
        phonetic,
        brief: extractBrief(m.detail),
      })
    }
  }

  // 按类型分组统计
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
