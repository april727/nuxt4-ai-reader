import { queryOne, runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string; notes: string }>(event)
  if (!body?.id) throw createError({ statusCode: 400, message: '缺少 id' })

  // 先查标题
  const titleRow = await queryOne('SELECT title FROM texts WHERE id=?', [body.id])
  const title = titleRow?.title || ''

  await runQuery('UPDATE texts SET notes=?, updatedAt=? WHERE id=?', [
    body.notes ?? '',
    new Date().toISOString(),
    body.id,
  ])

  // 同步创建/更新知识要点
  if (body.notes?.trim()) {
    const existing = await queryOne('SELECT id FROM knowledge_points WHERE sourceId=? AND sourceType=\'podcast_note\' LIMIT 1', [body.id])
    if (existing) {
      await runQuery('UPDATE knowledge_points SET content=? WHERE id=?', [body.notes.slice(0, 50000), existing.id])
    } else {
      const kpId = `kp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const now = new Date().toISOString()
      await runQuery(
        `INSERT INTO knowledge_points (id,content,note,sourceId,sourceTitle,sourceType,sortOrder,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [kpId, body.notes.slice(0, 50000), '', body.id, title, 'podcast_note', Date.now(), now, now]
      )
    }
  }

  return { ok: true }
})
