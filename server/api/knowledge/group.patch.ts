import { runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    action: 'move' | 'rename' | 'delete' | 'create'
    itemId?: string
    fromGroup?: string
    toGroup?: string
    oldName?: string
    newName?: string
    groupName?: string
  }>(event)

  if (!body.action) throw createError({ statusCode: 400, message: '缺少 action' })

  if (body.action === 'move' && body.itemId && body.toGroup !== undefined) {
    await runQuery('UPDATE knowledge_points SET customGroup=? WHERE id=?', [body.toGroup, body.itemId])
    return { ok: true }
  }

  if (body.action === 'rename' && body.oldName && body.newName) {
    await runQuery('UPDATE knowledge_points SET customGroup=? WHERE customGroup=?', [body.newName, body.oldName])
    return { ok: true }
  }

  if (body.action === 'delete' && body.groupName) {
    await runQuery('UPDATE knowledge_points SET customGroup=? WHERE customGroup=?', ['', body.groupName])
    return { ok: true }
  }

  if (body.action === 'create' && body.groupName && body.itemId) {
    await runQuery('UPDATE knowledge_points SET customGroup=? WHERE id=?', [body.groupName, body.itemId])
    return { ok: true }
  }

  throw createError({ statusCode: 400, message: '参数不完整' })
})
