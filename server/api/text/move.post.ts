import { runQuery } from '../../utils/db'
import { clearCache } from '../../utils/cache'
import { invalidateFolderCache } from '../../utils/folderCache'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string; folder: string }>(event)
  if (!body?.id || !body?.folder) throw createError({ statusCode: 400 })
  await runQuery('UPDATE texts SET folder=?,updatedAt=? WHERE id=?', [body.folder, new Date().toISOString(), body.id])
  // marks 表冗余了文件夹（复习本按文件夹筛选时读取），移动时一并刷新
  await runQuery('UPDATE marks SET textFolder=? WHERE textId=?', [body.folder, body.id])
  clearCache()              // 清理文本列表、计数缓存
  invalidateFolderCache()   // 清理文件夹列表缓存
  return { ok: true }
})
