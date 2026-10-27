import { gradeSheetWrong } from '../../../utils/sheetWrong'
import type { Grade } from '../../../utils/srs'

const GRADES = new Set<Grade>(['again', 'hard', 'good', 'easy'])

/** 给一道错题打分（again/hard/good/easy），返回下一次到期时间 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ id?: string; grade?: string }>(event)
  const id = String(body?.id || '')
  const grade = String(body?.grade || '') as Grade
  if (!id) throw createError({ statusCode: 400, message: '缺少 id' })
  if (!GRADES.has(grade)) throw createError({ statusCode: 400, message: 'grade 只能是 again/hard/good/easy' })
  return gradeSheetWrong(id, grade)
})
