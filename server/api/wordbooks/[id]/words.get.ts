import { getDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  if (!bookId) throw createError({ statusCode: 400 })

  const db = await getDb()
  const rows: any[] = []
  const stmt = db.prepare('SELECT * FROM words WHERE bookId=? ORDER BY createdAt DESC')
  stmt.bind([bookId])
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
})
