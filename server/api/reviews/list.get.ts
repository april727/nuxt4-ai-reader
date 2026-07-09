import { queryAll } from '../../utils/db'

const TYPE_COLORS: Record<string, string> = {
  word: '#f59e0b',
  phrase: '#10b981',
  sentence: '#06b6d4',
  note: '#f9a8d4',
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const page = Math.max(1, parseInt(query.page as string) || 1)
  const pageSize = Math.min(5000, Math.max(10, parseInt(query.pageSize as string) || 500))
  const offset = (page - 1) * pageSize

  // 从 words 表加载词性索引
  const posIndex = new Map<string, string>()
  const wordRows = await queryAll('SELECT word, pos FROM words WHERE pos IS NOT NULL AND pos != \'\'')
  for (const w of wordRows) {
    const key = (w.word as string).trim().toLowerCase()
    if (!posIndex.has(key)) {
      posIndex.set(key, (w.pos as string) || '')
    }
  }

  // 从 marks 独立表读取，按时间降序分页
  const markRows = await queryAll(
    'SELECT * FROM marks ORDER BY createdAt DESC LIMIT ? OFFSET ?',
    [pageSize, offset]
  )

  // 统计总数
  const countRow = await queryAll('SELECT COUNT(*) as c FROM marks')
  const total = Number((countRow[0] as any)?.c ?? 0)

  const items = markRows.map((row: any) => {
    const mark = {
      id: row.id,
      type: row.type,
      text: row.text,
      lemma: row.lemma,
      detail: row.detail,
      note: row.note,
      color: TYPE_COLORS[row.type] || '#a09e97',
      createdAt: row.createdAt,
    }
    const phonetic = row.detail
      ? (row.detail.match(/\[PHONETIC\]\s*(\/[^/]+\/)\s*\[\/PHONETIC\]/) || [])[1] || ''
      : ''
    const pos = posIndex.get((row.text || '').trim().toLowerCase()) || ''

    return {
      mark,
      title: row.textTitle,
      textId: row.textId,
      textFolder: row.textFolder,
      phonetic,
      pos,
      brief: extractBrief(row.detail || ''),
    }
  })

  return { items, total, page, pageSize, hasMore: offset + pageSize < total }
})

function extractBrief(detail: string): string {
  if (!detail) return ''
  return detail
    .replace(/\[PHONETIC\].*?\[\/PHONETIC\]/g, '')
    .replace(/[#*|`]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 180)
}
