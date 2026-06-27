import { queryOne, runQuery } from '../../utils/db'
import { moveToTrash } from '../../utils/storage'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string }>(event)
  if (!body?.id) throw createError({ statusCode: 400 })

  // 删除前获取 folder 和 title，用于组织垃圾箱路径
  const textRow = await queryOne('SELECT folder, title FROM texts WHERE id=?', [body.id])
  const folderId = textRow?.folder || 'default'
  const title = textRow?.title || body.id

  // 移动文件到垃圾箱
  moveToTrash(folderId, body.id, title)

  // 删除数据库记录
  await runQuery('DELETE FROM texts WHERE id=?', [body.id])

  return { ok: true }
})
