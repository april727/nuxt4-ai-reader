import { runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  const { name } = await readBody<{ name: string }>(event)
  if (!bookId || !name?.trim()) throw createError({ statusCode: 400 })

  await runQuery('UPDATE wordbooks SET name=? WHERE id=?', [name.trim(), bookId])
  return { ok: true }
})
