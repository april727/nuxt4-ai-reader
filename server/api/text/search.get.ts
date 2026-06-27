import { queryAll, queryOne } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const q = (getQuery(event).q as string || '').trim()
  if (!q) return []

  const rows = await queryAll("SELECT id,title,excerpt,source,createdAt FROM texts WHERE text LIKE ? OR title LIKE ? ORDER BY createdAt DESC LIMIT 20", [`%${q}%`, `%${q}%`])

  const results: any[] = []
  for (const r of rows) {
    // find match context
    try {
      const full = await queryOne('SELECT text FROM texts WHERE id=?', [r.id])
      if (full) {
        const idx = String(full.text).toLowerCase().indexOf(q.toLowerCase())
        if (idx >= 0) r.context = String(full.text).slice(Math.max(0, idx - 30), idx + q.length + 60)
      }
    } catch {}
    results.push({ id: r.id, title: r.title, source: r.source, context: r.context || r.excerpt })
  }
  return results
})
