import { getDb, saveDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  if (!bookId) throw createError({ statusCode: 400 })

  const db = await getDb()
  // 不允许删除默认单词本
  const chk = db.prepare('SELECT isDefault FROM wordbooks WHERE id=?')
  chk.bind([bookId])
  if (chk.step() && chk.getAsObject().isDefault) {
    chk.free(); throw createError({ statusCode: 403, message: '不能删除默认单词本' })
  }
  chk.free()
  db.run('DELETE FROM words WHERE bookId=?', [bookId])
  db.run('DELETE FROM wordbooks WHERE id=?', [bookId])
  await saveDb()
  return { ok: true }
})
