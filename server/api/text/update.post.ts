import { getDb, saveDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    id: string; analysis?: any; segments?: any[]; explanations?: Record<string,string>
    marks?: any[]; readingPosition?: any; paragraphChats?: Record<string, any[]>
  }>(event)
  if (!body?.id) throw createError({ statusCode: 400 })

  const db = await getDb()
  // 先读现有数据
  const stmt = db.prepare('SELECT * FROM texts WHERE id=?')
  stmt.bind([body.id])
  if (!stmt.step()) { stmt.free(); throw createError({ statusCode: 404 }) }
  const existing = stmt.getAsObject()
  stmt.free()

  // 合并
  const analysis = body.analysis ? JSON.stringify(body.analysis) : existing.analysis
  const segments = body.segments ? JSON.stringify(body.segments) : existing.segments
  let explanations = existing.explanations || '{}'
  if (body.explanations) {
    const cur = existing.explanations ? JSON.parse(existing.explanations) : {}
    explanations = JSON.stringify({ ...cur, ...body.explanations })
  }
  const marks = body.marks !== undefined ? JSON.stringify(body.marks) : existing.marks
  const readingPosition = body.readingPosition !== undefined ? JSON.stringify(body.readingPosition) : existing.readingPosition
  let paragraphChats = existing.paragraphChats || '{}'
  if (body.paragraphChats) {
    paragraphChats = JSON.stringify(body.paragraphChats)
  }

  db.run(`UPDATE texts SET analysis=?,segments=?,explanations=?,marks=?,readingPosition=?,paragraphChats=?,updatedAt=? WHERE id=?`,
    [analysis, segments, explanations, marks, readingPosition, paragraphChats, new Date().toISOString(), body.id])
  await saveDb()
  return { ok: true }
})
