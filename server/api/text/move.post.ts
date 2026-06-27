import { runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string; folder: string }>(event)
  if (!body?.id || !body?.folder) throw createError({ statusCode: 400 })
  await runQuery('UPDATE texts SET folder=?,updatedAt=? WHERE id=?', [body.folder, new Date().toISOString(), body.id])
  return { ok: true }
})
