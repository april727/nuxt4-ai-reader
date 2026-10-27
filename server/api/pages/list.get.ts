import { queryAll } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const groupId = (query.groupId as string) || ''

  if (!groupId) throw createError({ statusCode: 400, message: 'groupId 不能为空' })

  const rows = await queryAll(
    'SELECT * FROM knowledge_pages WHERE groupId=? ORDER BY updatedAt DESC',
    [groupId]
  )

  return rows.map((r: any) => ({
    id: r.id,
    groupId: r.groupId,
    title: r.title || '未命名',
    content: r.content || '',
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }))
})
