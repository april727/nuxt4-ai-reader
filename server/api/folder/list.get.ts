import { getDb, saveDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const parent = (query.parent as string) || ''
  const db = await getDb()

  // 兼容旧表无 parent 列
  let hasParent = true
  try { db.exec("SELECT parent FROM folders LIMIT 1") } catch { hasParent = false }

  let stmt
  if (hasParent) {
    if (parent) {
      stmt = db.prepare('SELECT * FROM folders WHERE parent=? ORDER BY createdAt')
      stmt.bind([parent])
    } else {
      stmt = db.prepare("SELECT * FROM folders WHERE (parent='' OR parent IS NULL) ORDER BY createdAt")
    }
  } else {
    stmt = db.prepare('SELECT * FROM folders ORDER BY createdAt')
  }
  const rows: any[] = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()

  if (rows.length === 0 && !parent) {
    const id = 'default'
    db.run("INSERT OR IGNORE INTO folders VALUES (?,?,?,?)", [id, '默认文件夹', '', new Date().toISOString()])
    await saveDb()
    return [{ id, name: '默认文件夹', parent: '', createdAt: new Date().toISOString() }]
  }
  return rows
})
