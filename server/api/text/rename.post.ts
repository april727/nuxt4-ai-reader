import { runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string; title: string }>(event)
  if (!body?.id || !body?.title?.trim()) throw createError({ statusCode: 400 })
  await runQuery('UPDATE texts SET title=?,updatedAt=? WHERE id=?', [body.title.trim(), new Date().toISOString(), body.id])
  return { ok: true }
})
