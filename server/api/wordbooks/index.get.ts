import { getDb } from '../../utils/db'

export default defineEventHandler(async () => {
  const db = await getDb()
  const rows: any[] = []
  const stmt = db.prepare('SELECT * FROM wordbooks ORDER BY isDefault DESC, sortOrder, createdAt')
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()

  // 统计每个单词本的单词数
  for (const row of rows) {
    const cs = db.prepare('SELECT COUNT(*) as cnt FROM words WHERE bookId=?')
    cs.bind([row.id])
    if (cs.step()) row.wordCount = cs.getAsObject().cnt
    cs.free()

    // 待复习数
    const rs = db.prepare("SELECT COUNT(*) as cnt FROM words WHERE bookId=? AND phase='review' AND nextReview <= datetime('now')")
    rs.bind([row.id])
    if (rs.step()) row.dueCount = rs.getAsObject().cnt
    rs.free()
  }

  return rows
})
