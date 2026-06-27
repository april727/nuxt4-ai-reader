import { queryOne, runQuery } from '../../utils/db'
import { invalidateFolderCache } from '../../utils/folderCache'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ name: string; parent?: string }>(event)
  if (!body?.name?.trim()) throw createError({ statusCode: 400, message: '文件夹名称不能为空' })

  const parent = body.parent || ''
  const name = body.name.trim()

  // 同上级下同名检查（兼容旧表）
  let dup = false
  try {
    const dupRow = await queryOne('SELECT id FROM folders WHERE name=? AND parent=?', [name, parent])
    dup = !!dupRow
  } catch {
    // 无 parent 列则只按名称查
    const dupRow = await queryOne('SELECT id FROM folders WHERE name=?', [name])
    dup = !!dupRow
  }
  if (dup) throw createError({ statusCode: 409, message: '文件夹已存在' })

  const id = 'folder_' + Date.now()
  try {
    await runQuery('INSERT INTO folders (id,name,parent,createdAt) VALUES (?,?,?,?)', [id, name, parent, new Date().toISOString()])
  } catch {
    await runQuery('INSERT INTO folders (id,name,createdAt) VALUES (?,?,?)', [id, name, new Date().toISOString()])
  }
  invalidateFolderCache()
  return { id, name, parent }
})
