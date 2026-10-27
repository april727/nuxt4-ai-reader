import { queryOne, runQuery } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  const { word, phonetic, meaning, example, note } = await readBody<{
    word: string; phonetic?: string; meaning?: string; example?: string; note?: string
  }>(event)
  if (!bookId || !word?.trim()) throw createError({ statusCode: 400 })

  // 防重复
  const dup = await queryOne('SELECT id FROM words WHERE bookId=? AND word=?', [bookId, word.trim()])
  if (dup) throw createError({ statusCode: 409, message: '单词已存在' })

  const id = `w_${Date.now()}`
  const now = new Date().toISOString()
  await runQuery(
    `INSERT INTO words (id,bookId,word,phonetic,meaning,example,note,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, bookId, word.trim(), phonetic || '', meaning || '', example || '', note || '', now, now]
  )
  return { id, word: word.trim(), phonetic, meaning, example, note }
})
