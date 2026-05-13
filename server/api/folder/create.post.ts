import { getDb, saveDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ name: string; parent?: string }>(event)
  if (!body?.name?.trim()) throw createError({ statusCode: 400, message: '文件夹名称不能为空' })

  const db = await getDb()
  const parent = body.parent || ''
  const name = body.name.trim()

  // 同上级下同名检查（兼容旧表）
  let dup = false
  try {
    const stmt = db.prepare('SELECT id FROM folders WHERE name=? AND parent=?')
    stmt.bind([name, parent])
    dup = stmt.step()
    stmt.free()
  } catch {
    // 无 parent 列则只按名称查
    const stmt = db.prepare('SELECT id FROM folders WHERE name=?')
    stmt.bind([name])
    dup = stmt.step()
    stmt.free()
  }
  if (dup) throw createError({ statusCode: 409, message: '文件夹已存在' })

  const id = 'folder_' + Date.now()
  try {
    db.run('INSERT INTO folders (id,name,parent,createdAt) VALUES (?,?,?,?)', [id, name, parent, new Date().toISOString()])
  } catch {
    db.run('INSERT INTO folders (id,name,createdAt) VALUES (?,?,?)', [id, name, new Date().toISOString()])
  }
  await saveDb()
  return { id, name, parent }
})
