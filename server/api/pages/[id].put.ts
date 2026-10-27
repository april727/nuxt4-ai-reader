import { runQuery, queryOne } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400 })

  const body = await readBody<{ title?: string; content?: string }>(event)

  const page = await queryOne('SELECT id, groupId FROM knowledge_pages WHERE id=?', [id])
  if (!page) throw createError({ statusCode: 404 })

  const now = new Date().toISOString()

  if (body.title !== undefined) {
    await runQuery('UPDATE knowledge_pages SET title=?, updatedAt=? WHERE id=?', [body.title.trim() || '未命名页面', now, id])
  }
  if (body.content !== undefined) {
    await runQuery('UPDATE knowledge_pages SET content=?, updatedAt=? WHERE id=?', [body.content, now, id])
  }

  return { ok: true }
})
