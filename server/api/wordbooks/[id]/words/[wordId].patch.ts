import { getDb, saveDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  const wordId = getRouterParam(event, 'wordId')
  const body = await readBody<{
    word?: string; phonetic?: string; meaning?: string; example?: string; note?: string
    phase?: string; learnCorrect?: number; learnTotal?: number; learnWrong?: number
    ease?: number; interval?: number; repetitions?: number; nextReview?: string
  }>(event)

  if (!bookId || !wordId) throw createError({ statusCode: 400 })

  const db = await getDb()
  const sets: string[] = []
  const vals: any[] = []

  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) { sets.push(`${k}=?`); vals.push(v) }
  }
  if (!sets.length) throw createError({ statusCode: 400, message: '无更新字段' })

  sets.push('updatedAt=?'); vals.push(new Date().toISOString())
  vals.push(wordId, bookId)

  db.run(`UPDATE words SET ${sets.join(',')} WHERE id=? AND bookId=?`, vals)
  await saveDb()
  return { ok: true }
})
