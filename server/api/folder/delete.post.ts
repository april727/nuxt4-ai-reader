import { getDb, saveDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string }>(event)
  if (!body?.id) throw createError({ statusCode: 400 })

  const db = await getDb()

  // 检查是否有书籍
  const stmt = db.prepare('SELECT COUNT(*) as c FROM texts WHERE folder=?')
  stmt.bind([body.id])
  let count = 0
  if (stmt.step()) count = stmt.getAsObject().c
  stmt.free()

  if (count > 0) throw createError({ statusCode: 409, message: `该文件夹下有 ${count} 本书，请先移走或删除书籍` })

  // 检查是否有子文件夹（兼容旧表无 parent 列）
  let subCount = 0
  try {
    const stmt2 = db.prepare('SELECT COUNT(*) as c FROM folders WHERE parent=?')
    stmt2.bind([body.id])
    if (stmt2.step()) subCount = stmt2.getAsObject().c
    stmt2.free()
  } catch {}
  if (subCount > 0) throw createError({ statusCode: 409, message: `该文件夹下有 ${subCount} 个子文件夹，请先删除子文件夹` })

  db.run('DELETE FROM folders WHERE id=?', [body.id])
  await saveDb()
  return { ok: true }
})
