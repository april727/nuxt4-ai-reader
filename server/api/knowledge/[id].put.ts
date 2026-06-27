import { runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{
    content?: string
    note?: string
    tags?: string[]
  }>(event)

  if (!id) throw createError({ statusCode: 400, message: '缺少 ID' })

  const updates: string[] = []
  const params: any[] = []

  if (body.content !== undefined) { updates.push('content=?'); params.push(body.content) }
  if (body.note !== undefined) { updates.push('note=?'); params.push(body.note) }
  if (body.tags !== undefined) { updates.push('tags=?'); params.push(JSON.stringify(body.tags)) }

  if (updates.length === 0) return { ok: true }

  updates.push('updatedAt=?')
  params.push(new Date().toISOString())
  params.push(id)

  await runQuery(`UPDATE knowledge_points SET ${updates.join(',')} WHERE id=?`, params)

  return { ok: true }
})
