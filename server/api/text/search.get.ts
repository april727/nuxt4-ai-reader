import { getDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const q = (getQuery(event).q as string || '').trim()
  if (!q) return []

  const db = await getDb()
  const stmt = db.prepare("SELECT id,title,excerpt,source,createdAt FROM texts WHERE text LIKE ? OR title LIKE ? ORDER BY createdAt DESC LIMIT 20")
  stmt.bind([`%${q}%`, `%${q}%`])
  const rows: any[] = []
  while (stmt.step()) {
    const r = stmt.getAsObject()
    // find match context
    try {
      const textStmt = db.prepare('SELECT text FROM texts WHERE id=?')
      textStmt.bind([r.id])
      if (textStmt.step()) {
        const full = textStmt.getAsObject()
        const idx = String(full.text).toLowerCase().indexOf(q.toLowerCase())
        if (idx >= 0) r.context = String(full.text).slice(Math.max(0, idx - 30), idx + q.length + 60)
      }
      textStmt.free()
    } catch {}
    rows.push({ id: r.id, title: r.title, source: r.source, context: r.context || r.excerpt })
  }
  stmt.free()
  return rows
})
