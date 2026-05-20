import { getDb } from '../../utils/db'

export default defineEventHandler(async () => {
  const db = await getDb()

  // 一次性查询所有文件夹的文章数量
  const stmt = db.prepare(
    'SELECT folder, COUNT(*) as count FROM texts GROUP BY folder'
  )
  const counts: Record<string, number> = {}
  while (stmt.step()) {
    const row = stmt.getAsObject() as { folder: string; count: number }
    counts[row.folder] = row.count
  }
  stmt.free()

  return counts
})
