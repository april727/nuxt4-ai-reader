import { getDb, saveDb } from '../../utils/db'

// 标记类型 → 默认单词本 ID 映射
const MARK_TO_BOOK: Record<string, string> = {
  word: 'wb_default',
  phrase: 'wb_phrases',
  sentence: 'wb_sentences',
}

// 从 mark detail 中提取音标和释义
function extractPhonetic(detail: string): string {
  if (!detail) return ''
  const m = detail.match(/\[PHONETIC\]\s*(\/[^/]+\/)\s*\[\/PHONETIC\]/)
  return m?.[1] || ''
}

function extractMeaning(detail: string): string {
  if (!detail) return ''
  // 匹配 "### 基本释义" 之后到下一个 "###" 或标签之间的内容
  const m = detail.match(/###\s*基本释义\s*\n+([\s\S]*?)(?=\n###|\n\[PHONETIC\]|\n\[LEMMA\]|$)/)
  if (!m) return ''
  return m[1]
    .replace(/^[-*]\s*/gm, '')   // 去掉列表符号
    .replace(/\n+/g, '；')        // 多行合并为分号分隔
    .trim()
    .slice(0, 120)
}

function extractLemma(mark: any): string {
  // 优先用 mark 对象本身的 lemma 字段
  if (mark.lemma) return mark.lemma.trim()
  // 兜底从 detail 中解析 [LEMMA] 标签
  const m = (mark.detail || '').match(/\[LEMMA\]\/(.+?)\/\[\/LEMMA\]/)
  return m?.[1]?.trim() || ''
}

// 同步新增标记到对应的默认单词本
async function syncMarksToWordbooks(db: any, textId: string, oldMarksJson: string, newMarksJson: string) {
  let oldMarks: any[] = []
  let newMarks: any[] = []
  try { oldMarks = oldMarksJson ? JSON.parse(oldMarksJson) : [] } catch {}
  try { newMarks = JSON.parse(newMarksJson) } catch {}
  if (!newMarks.length) return

  // 找出新增的标记（旧列表中不存在的）
  const oldIds = new Set(oldMarks.map((m: any) => m.id))
  const added = newMarks.filter((m: any) => m.id && !oldIds.has(m.id))
  if (!added.length) return

  const now = new Date().toISOString()

  for (const mark of added) {
    const bookId = MARK_TO_BOOK[mark.type]
    if (!bookId || !mark.text?.trim()) continue

    // 确认目标单词本存在
    const wb = db.prepare('SELECT id FROM wordbooks WHERE id=?')
    wb.bind([bookId])
    if (!wb.step()) { wb.free(); continue }
    wb.free()

    // 去重：同一单词本中不重复添加相同文本
    const dup = db.prepare('SELECT id FROM words WHERE bookId=? AND word=?')
    dup.bind([bookId, mark.text.trim()])
    if (dup.step()) { dup.free(); continue }
    dup.free()

    const wordId = `w_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const phonetic = extractPhonetic(mark.detail || '')
    const meaning = extractMeaning(mark.detail || '')
    const lemma = extractLemma(mark)
    // 有原词时以原词为主词条，原文作为笔记
    const wordText = lemma || mark.text.trim()
    const note = lemma && lemma !== mark.text.trim()
      ? `原文: ${mark.text.trim()}${mark.note ? '\n' + mark.note : ''}`
      : mark.note || ''

    db.run(
      `INSERT INTO words (id,bookId,word,phonetic,meaning,note,source,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)`,
      [wordId, bookId, wordText, phonetic, meaning, note, textId, now, now]
    )
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    id: string; title?: string; analysis?: any; segments?: any[]; explanations?: Record<string,string>
    marks?: any[]; readingPosition?: any; paragraphChats?: Record<string, any[]>
  }>(event)
  if (!body?.id) throw createError({ statusCode: 400 })

  const db = await getDb()
  // 先读现有数据
  const stmt = db.prepare('SELECT * FROM texts WHERE id=?')
  stmt.bind([body.id])
  if (!stmt.step()) { stmt.free(); throw createError({ statusCode: 404 }) }
  const existing = stmt.getAsObject()
  stmt.free()

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

  db.run(`UPDATE texts SET title=?,analysis=?,segments=?,explanations=?,marks=?,readingPosition=?,paragraphChats=?,updatedAt=? WHERE id=?`,
    [title, analysis, segments, explanations, marks, readingPosition, paragraphChats, new Date().toISOString(), body.id])

  // markers 变更时，自动同步新增标记到对应单词本
  if (marksChanged) {
    await syncMarksToWordbooks(db, body.id, existing.marks || '[]', marks)
  }

  await saveDb()
  return { ok: true }
})
