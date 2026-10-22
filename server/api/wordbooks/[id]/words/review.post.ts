import { queryOne, runQuery } from '../../../../utils/db'
import { applyGrade, type Grade, type SrsState } from '../../../../utils/srs'

/** 白名单更新列，避免动态列名注入 */
const FIELDS: Array<keyof SrsState> = [
  'phase', 'learnCorrect', 'learnTotal', 'learnWrong', 'ease',
  'interval', 'repetitions', 'nextReview', 'reviewCount', 'lapses', 'lastReviewedAt',
]

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  const body = await readBody<{ wordId: string; grade: Grade }>(event)
  if (!bookId || !body?.wordId) throw createError({ statusCode: 400, message: '缺少 wordId' })
  if (!['again', 'hard', 'good', 'easy'].includes(body.grade)) {
    throw createError({ statusCode: 400, message: '无效的评分' })
  }

  const word = await queryOne('SELECT * FROM words WHERE id=? AND bookId=?', [body.wordId, bookId])
  if (!word) throw createError({ statusCode: 404, message: '词条不存在' })

  const next = applyGrade(word as unknown as SrsState, body.grade)
  const cols = FIELDS.filter(f => (next as any)[f] !== undefined)

  await runQuery(
    `UPDATE words SET ${cols.map(c => `${c}=?`).join(',')},updatedAt=? WHERE id=?`,
    [...cols.map(c => (next as any)[c]), new Date().toISOString(), body.wordId],
  )

  return { word: { ...word, ...next } }
})
