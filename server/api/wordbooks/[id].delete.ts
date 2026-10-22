import { queryOne, runQuery, runOnTurso, deleteRowsFromTurso } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  if (!bookId) throw createError({ statusCode: 400 })

  // 不允许删除默认单词本
  const chk = await queryOne('SELECT isDefault FROM wordbooks WHERE id=?', [bookId])
  if (chk?.isDefault) {
    throw createError({ statusCode: 403, message: '不能删除默认单词本' })
  }
  await runQuery('DELETE FROM words WHERE bookId=?', [bookId])
  await runQuery('DELETE FROM wordbooks WHERE id=?', [bookId])
  // 同步删除云端，防止被拉回
  await runOnTurso('DELETE FROM words WHERE bookId=?', [bookId])
  await deleteRowsFromTurso('wordbooks', 'id', [bookId])
  return { ok: true }
})
