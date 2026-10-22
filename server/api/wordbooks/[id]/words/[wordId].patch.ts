import { runQuery } from '../../../../utils/db'

/** 允许更新的列（白名单，避免动态列名注入） */
const ALLOWED = new Set([
  'word', 'phonetic', 'meaning', 'example', 'note', 'pos',
  'phase', 'learnCorrect', 'learnTotal', 'learnWrong',
  'ease', 'interval', 'repetitions', 'nextReview',
  'lastReviewedAt', 'reviewCount', 'lapses',
  'dismissedAt',
])

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  const wordId = getRouterParam(event, 'wordId')
  const body = await readBody<Record<string, any>>(event)

  if (!bookId || !wordId) throw createError({ statusCode: 400 })

  const sets: string[] = []
  const vals: any[] = []

  for (const [k, v] of Object.entries(body || {})) {
    if (!ALLOWED.has(k) || v === undefined) continue
    sets.push(`${k}=?`)
    vals.push(v)
  }
  if (!sets.length) throw createError({ statusCode: 400, message: '无更新字段' })

  sets.push('updatedAt=?')
  vals.push(new Date().toISOString())
  vals.push(wordId, bookId)

  await runQuery(`UPDATE words SET ${sets.join(',')} WHERE id=? AND bookId=?`, vals)
  return { ok: true }
})
