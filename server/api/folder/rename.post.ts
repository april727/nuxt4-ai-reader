import { runQuery } from '../../utils/db'
import { invalidateFolderCache } from '../../utils/folderCache'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string; name: string }>(event)
  if (!body?.id || !body?.name?.trim()) throw createError({ statusCode: 400 })

  await runQuery('UPDATE folders SET name=? WHERE id=?', [body.name.trim(), body.id])
  invalidateFolderCache()
  return { ok: true }
})
