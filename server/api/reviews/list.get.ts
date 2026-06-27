import { queryAll } from '../../utils/db'

export default defineEventHandler(async () => {
  // 预加载 words 表，建立 normalized_word → pos 的索引
  const posIndex = new Map<string, string>()
  const wordRows = await queryAll('SELECT word, pos FROM words WHERE pos IS NOT NULL AND pos != \'\'')
  for (const w of wordRows) {
    const key = (w.word as string).trim().toLowerCase()
    if (!posIndex.has(key)) {
      posIndex.set(key, (w.pos as string) || '')
    }
  }

  const textRows = await queryAll(
    `SELECT id, title, folder, marks FROM texts WHERE marks IS NOT NULL AND marks != '' AND marks != '[]'`
  )

  const items: any[] = []

  for (const row of textRows) {
    let marks: any[] = []
    try { marks = JSON.parse(row.marks) } catch { continue }
    if (!marks.length) continue

    for (const m of marks) {
      if (!m.id) continue
      const phonetic = m.detail
        ? (m.detail.match(/\[PHONETIC\]\s*(\/[^/]+\/)\s*\[\/PHONETIC\]/) || [])[1] || ''
        : ''
      // 从 words 表查找对应的词性
      const pos = posIndex.get((m.text || '').trim().toLowerCase()) || ''
      items.push({
        mark: m,
        title: row.title,
        textId: row.id,
        textFolder: row.folder || 'default',
        phonetic,
        pos,
        brief: extractBrief(m.detail),
      })
    }
  }

  // 按时间降序
  items.sort((a, b) => (b.mark.createdAt || '').localeCompare(a.mark.createdAt || ''))

  return { items }
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
