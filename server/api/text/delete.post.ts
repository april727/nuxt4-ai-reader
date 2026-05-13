import { getDb, saveDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string }>(event)
  if (!body?.id) throw createError({ statusCode: 400 })
  const db = await getDb()
  db.run('DELETE FROM texts WHERE id=?', [body.id])
  await saveDb()
  return { ok: true }
})
