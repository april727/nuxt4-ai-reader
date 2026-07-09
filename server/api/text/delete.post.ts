import { queryOne, runQuery } from '../../utils/db'
import { moveToTrash } from '../../utils/storage'
import { clearCache } from '../../utils/cache'
import { invalidateFolderCache } from '../../utils/folderCache'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string }>(event)
  if (!body?.id) throw createError({ statusCode: 400 })

  // 删除前获取 folder 和 title，用于组织垃圾箱路径
  const textRow = await queryOne('SELECT folder, title FROM texts WHERE id=?', [body.id])
  const folderId = textRow?.folder || 'default'
  const title = textRow?.title || body.id

  // 移动文件到垃圾箱
  moveToTrash(folderId, body.id, title)

  // 删除关联的 marks 表数据
  await runQuery('DELETE FROM marks WHERE textId=?', [body.id])

  // 删除数据库记录
  await runQuery('DELETE FROM texts WHERE id=?', [body.id])

  clearCache()
  invalidateFolderCache()

  return { ok: true }
})
