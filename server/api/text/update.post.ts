import { queryOne, runQuery } from '../../utils/db'
import { syncMarks } from '../../utils/marksSync'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    id: string; title?: string; analysis?: any; segments?: any[]; explanations?: Record<string,string>
    marks?: any[]; readingPosition?: any; paragraphChats?: Record<string, any[]>
    paragraphNotes?: any[]; paragraphNotesMap?: Record<string, string>
  }>(event)
  if (!body?.id) throw createError({ statusCode: 400 })

  // 先读现有数据
  const existing = await queryOne('SELECT * FROM texts WHERE id=?', [body.id])
  if (!existing) throw createError({ statusCode: 404 })

  // 合并
  const title = body.title || existing.title
  const analysis = body.analysis ? JSON.stringify(body.analysis) : existing.analysis
  const segments = body.segments ? JSON.stringify(body.segments) : existing.segments
  let explanations = existing.explanations || '{}'
  if (body.explanations) {
    const cur = existing.explanations ? JSON.parse(existing.explanations) : {}
    explanations = JSON.stringify({ ...cur, ...body.explanations })
  }
  const marksChanged = body.marks !== undefined
  const marks = marksChanged ? JSON.stringify(body.marks) : existing.marks
  const readingPosition = body.readingPosition !== undefined ? JSON.stringify(body.readingPosition) : existing.readingPosition
  let paragraphChats = existing.paragraphChats || '{}'
  if (body.paragraphChats) {
    paragraphChats = JSON.stringify(body.paragraphChats)
  }
  const paragraphNotes = body.paragraphNotes !== undefined ? JSON.stringify(body.paragraphNotes) : existing.paragraphNotes
  const paragraphNotesMap = body.paragraphNotesMap !== undefined ? JSON.stringify(body.paragraphNotesMap) : existing.paragraphNotesMap

  await runQuery(`UPDATE texts SET title=?,analysis=?,segments=?,explanations=?,marks=?,readingPosition=?,paragraphChats=?,paragraphNotes=?,paragraphNotesMap=?,updatedAt=? WHERE id=?`,
    [title, analysis, segments, explanations, marks, readingPosition, paragraphChats, paragraphNotes, paragraphNotesMap, new Date().toISOString(), body.id])

  // markers 变更时，同步 marks 独立表 + 单词本
  if (marksChanged) {
    await syncMarks(body.id, title, existing.folder || 'default', existing.marks || '[]', marks)
  }

  return { ok: true }
})
