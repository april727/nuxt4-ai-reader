import { runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string; title: string }>(event)
  if (!body?.id || !body?.title?.trim()) throw createError({ statusCode: 400 })
  await runQuery('UPDATE texts SET title=?,updatedAt=? WHERE id=?', [body.title.trim(), new Date().toISOString(), body.id])
  // marks 表冗余了标题（复习本/回收站/每日详情直接读它），改名时一并刷新
  await runQuery('UPDATE marks SET textTitle=? WHERE textId=?', [body.title.trim(), body.id])
  return { ok: true }
})
