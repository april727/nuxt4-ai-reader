import { getDb, saveDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string; notes: string }>(event)
  if (!body?.id) throw createError({ statusCode: 400, message: '缺少 id' })

  const db = await getDb()
  db.run('UPDATE texts SET notes=?, updatedAt=? WHERE id=?', [
    body.notes ?? '',
    new Date().toISOString(),
    body.id,
  ])
  await saveDb()
  return { ok: true }
})
