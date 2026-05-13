import { getDb, saveDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string; folder: string }>(event)
  if (!body?.id || !body?.folder) throw createError({ statusCode: 400 })
  const db = await getDb()
  db.run('UPDATE texts SET folder=?,updatedAt=? WHERE id=?', [body.folder, new Date().toISOString(), body.id])
  await saveDb()
  return { ok: true }
})
