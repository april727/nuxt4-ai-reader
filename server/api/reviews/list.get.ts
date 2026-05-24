import { getDb } from '../../utils/db'

export default defineEventHandler(async () => {
  const db = await getDb()

  const stmt = db.prepare(
    `SELECT id, title, folder, marks FROM texts WHERE marks IS NOT NULL AND marks != '' AND marks != '[]'`
  )

  const items: any[] = []

  while (stmt.step()) {
    const row = stmt.getAsObject()
    let marks: any[] = []
    try { marks = JSON.parse(row.marks) } catch { continue }
    if (!marks.length) continue

    for (const m of marks) {
      if (!m.id) continue
      const phonetic = m.detail
        ? (m.detail.match(/\[PHONETIC\]\s*(\/[^/]+\/)\s*\[\/PHONETIC\]/) || [])[1] || ''
        : ''
      items.push({
        mark: m,
        title: row.title,
        textId: row.id,
        textFolder: row.folder || 'default',
        phonetic,
        brief: extractBrief(m.detail),
      })
    }
  }
  stmt.free()

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
