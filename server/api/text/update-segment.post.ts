import { getDb, saveDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ textId: string; segmentId: string; text: string }>(event)
  if (!body?.textId || !body?.segmentId || !body?.text?.trim()) throw createError({ statusCode: 400 })
  const db = await getDb()

  const stmt = db.prepare('SELECT segments FROM texts WHERE id=?')
  stmt.bind([body.textId])
  if (!stmt.step()) { stmt.free(); throw createError({ statusCode: 404 }) }
  const row = stmt.getAsObject()
  stmt.free()

  let segs = []
  try { segs = JSON.parse(row.segments || '[]') } catch {}
  const seg = segs.find((s: any) => s.id === body.segmentId)
  if (!seg) throw createError({ statusCode: 404, message: '段落不存在' })
  seg.text = body.text.trim()

  db.run('UPDATE texts SET segments=?,updatedAt=? WHERE id=?', [JSON.stringify(segs), new Date().toISOString(), body.textId])
  await saveDb()
  return { ok: true }
})
