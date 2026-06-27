import { runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string }>(event)
  if (!body?.id) throw createError({ statusCode: 400, message: '缺少 ID' })

  const now = new Date().toISOString()
  await runQuery('UPDATE texts SET completedAt=? WHERE id=?', [now, body.id])

  return { completedAt: now }
})
