import { runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    content: string
    note?: string
    sourceId?: string
    sourceTitle?: string
    sourceType?: string
    sourceContext?: string
    tags?: string[]
  }>(event)

  if (!body?.content?.trim()) throw createError({ statusCode: 400, message: '内容不能为空' })

  const id = `kp_${Date.now()}`
  const now = new Date().toISOString()

  await runQuery(
    `INSERT INTO knowledge_points (id,content,note,sourceId,sourceTitle,sourceType,sourceContext,tags,sortOrder,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      body.content.trim(),
      body.note || '',
      body.sourceId || '',
      body.sourceTitle || '',
      body.sourceType || 'selection',
      body.sourceContext || '',
      JSON.stringify(body.tags || []),
      Date.now(),
      now,
      now,
    ]
  )

  return { id, createdAt: now }
})
