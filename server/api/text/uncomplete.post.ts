import { runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string }>(event)
  if (!body?.id) throw createError({ statusCode: 400, message: '缺少 ID' })

  await runQuery('UPDATE texts SET completedAt=NULL WHERE id=?', [body.id])

  return { success: true }
})
