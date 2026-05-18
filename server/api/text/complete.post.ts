import { getDb, saveDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string }>(event)
  if (!body?.id) throw createError({ statusCode: 400, message: '缺少 ID' })

  const db = await getDb()
  const now = new Date().toISOString()
  db.run('UPDATE texts SET completedAt=? WHERE id=?', [now, body.id])
  await saveDb()

  return { completedAt: now }
})
