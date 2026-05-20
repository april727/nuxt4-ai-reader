import { getDb, saveDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string; paragraphId: string; imageName: string }>(event)
  if (!body?.id || !body.paragraphId || !body.imageName) {
    throw createError({ statusCode: 400 })
  }

  const db = await getDb()
  const stmt = db.prepare('SELECT segments FROM texts WHERE id=?')
  stmt.bind([body.id])
  if (!stmt.step()) { stmt.free(); throw createError({ statusCode: 404 }) }
  const row = stmt.getAsObject()
  stmt.free()

  let segments: any[] = []
  try { segments = JSON.parse(row.segments || '[]') } catch {}

  const para = segments.find((s: any) => s.id === body.paragraphId)
  if (para?.images) {
    para.images = para.images.filter((n: string) => n !== body.imageName)
  }

  db.run('UPDATE texts SET segments=?,updatedAt=? WHERE id=?',
    [JSON.stringify(segments), new Date().toISOString(), body.id])
  await saveDb()

  return { ok: true }
})
