import { runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ groupId: string; title: string }>(event)
  if (!body?.groupId) throw createError({ statusCode: 400, message: 'groupId 不能为空' })

  const id = `page_${Date.now()}`
  const now = new Date().toISOString()

  await runQuery(
    'INSERT INTO knowledge_pages (id, groupId, title, content, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
    [id, body.groupId, body.title?.trim() || '未命名页面', '', now, now]
  )

  return { id, groupId: body.groupId, title: body.title?.trim() || '未命名页面', content: '', createdAt: now, updatedAt: now }
})
