import { runQuery } from '../../utils/db'
import { clearCache } from '../../utils/cache'
import { invalidateFolderCache } from '../../utils/folderCache'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string }>(event)
  if (!body?.id) throw createError({ statusCode: 400 })

  const now = new Date().toISOString()

  // 软删除：保留数据库行与磁盘文件（便于回收站恢复），标记 deletedAt 后从书架隐藏
  await runQuery('UPDATE texts SET deletedAt=?, updatedAt=? WHERE id=?', [now, now, body.id])
  // 该文本的标记在 marks 表中也软删除（避免出现在复习/统计；父文本隐藏时归入回收站文件）
  await runQuery('UPDATE marks SET deletedAt=? WHERE textId=? AND deletedAt IS NULL', [now, body.id])
  // 词条保留（仍可复习），但标记来源已失效，供 UI 提示「原文已删除」
  try { await runQuery("UPDATE words SET orphanedAt=? WHERE source=? AND (orphanedAt IS NULL OR orphanedAt='')", [now, body.id]) } catch {}

  clearCache()
  invalidateFolderCache()

  return { ok: true }
})
