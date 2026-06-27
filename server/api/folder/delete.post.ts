import { queryOne, runQuery } from '../../utils/db'
import { invalidateFolderCache } from '../../utils/folderCache'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string }>(event)
  if (!body?.id) throw createError({ statusCode: 400 })

  // 检查是否有书籍
  const countRow = await queryOne('SELECT COUNT(*) as c FROM texts WHERE folder=?', [body.id])
  const count = countRow?.c || 0

  if (count > 0) throw createError({ statusCode: 409, message: `该文件夹下有 ${count} 本书，请先移走或删除书籍` })

  // 检查是否有子文件夹（兼容旧表无 parent 列）
  let subCount = 0
  try {
    const subRow = await queryOne('SELECT COUNT(*) as c FROM folders WHERE parent=?', [body.id])
    subCount = subRow?.c || 0
  } catch {}
  if (subCount > 0) throw createError({ statusCode: 409, message: `该文件夹下有 ${subCount} 个子文件夹，请先删除子文件夹` })

  await runQuery('DELETE FROM folders WHERE id=?', [body.id])
  invalidateFolderCache()
  return { ok: true }
})
