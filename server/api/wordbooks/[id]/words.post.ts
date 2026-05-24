import { getDb, saveDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  const { word, phonetic, meaning, example, note } = await readBody<{
    word: string; phonetic?: string; meaning?: string; example?: string; note?: string
  }>(event)
  if (!bookId || !word?.trim()) throw createError({ statusCode: 400 })

  const db = await getDb()
  // 防重复
  const dup = db.prepare('SELECT id FROM words WHERE bookId=? AND word=?')
  dup.bind([bookId, word.trim()])
  if (dup.step()) { dup.free(); throw createError({ statusCode: 409, message: '单词已存在' }) }
  dup.free()

  const id = `w_${Date.now()}`
  const now = new Date().toISOString()
  db.run(
    `INSERT INTO words (id,bookId,word,phonetic,meaning,example,note,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, bookId, word.trim(), phonetic || '', meaning || '', example || '', note || '', now, now]
  )
  await saveDb()
  return { id, word: word.trim(), phonetic, meaning, example, note }
})
