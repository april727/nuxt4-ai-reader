import { getDb, saveDb } from '../../utils/db'

// 标记类型 → 默认单词本 ID 映射
const MARK_TO_BOOK: Record<string, string> = {
  word: 'wb_default',
  phrase: 'wb_phrases',
  sentence: 'wb_sentences',
}

function extractPhonetic(detail: string): string {
  if (!detail) return ''
  const m = detail.match(/\[PHONETIC\]\s*(\/[^/]+\/)\s*\[\/PHONETIC\]/)
  return m?.[1] || ''
}

function extractMeaning(detail: string): string {
  if (!detail) return ''
  const m = detail.match(/###\s*基本释义\s*\n+([\s\S]*?)(?=\n###|\n\[PHONETIC\]|\n\[LEMMA\]|$)/)
  if (!m) return ''
  return m[1]
    .replace(/^[-*]\s*/gm, '')
    .replace(/\n+/g, '；')
    .trim()
    .slice(0, 120)
}

function extractLemma(mark: any): string {
  if (mark.lemma) return mark.lemma.trim()
  const m = (mark.detail || '').match(/\[LEMMA\]\/(.+?)\/\[\/LEMMA\]/)
  return m?.[1]?.trim() || ''
}

function extractPos(detail: string): string {
  if (!detail) return ''
  const m = detail.match(/\[POS\]\s*(n\.|v\.|adj\.|adv\.|pron\.|prep\.|conj\.|interj\.|art\.|num\.|det\.|modal\.|aux\.)\s*\[\/POS\]/i)
  if (m) return m[1].toLowerCase()
  return ''
}

// 批量同步所有已有标记到对应单词本（去重、幂等）
export default defineEventHandler(async () => {
  const db = await getDb()

  // 确保三个默认单词本存在
  for (const [bookId, name] of [
    ['wb_default', '默认单词本'],
    ['wb_phrases', '默认短语本'],
    ['wb_sentences', '默认句子本'],
  ] as const) {
    const check = db.prepare('SELECT id FROM wordbooks WHERE id=?')
    check.bind([bookId])
    if (!check.step()) {
      db.run('INSERT INTO wordbooks (id,name,isDefault,createdAt) VALUES (?,?,1,?)',
        [bookId, name, new Date().toISOString()])
    }
    check.free()
  }

  // 读取所有有标记的文本
  const stmt = db.prepare(
    `SELECT id, marks FROM texts WHERE marks IS NOT NULL AND marks != '' AND marks != '[]'`
  )

  const now = new Date().toISOString()
  let synced = 0
  let skipped = 0

  while (stmt.step()) {
    const row = stmt.getAsObject()
    let marks: any[] = []
    try { marks = JSON.parse(row.marks) } catch { continue }
    if (!marks.length) continue

    for (const mark of marks) {
      const bookId = MARK_TO_BOOK[mark.type]
      if (!bookId || !mark.text?.trim()) continue

      // 去重
      const dup = db.prepare('SELECT id FROM words WHERE bookId=? AND word=?')
      dup.bind([bookId, mark.text.trim()])
      if (dup.step()) { dup.free(); skipped++; continue }
      dup.free()

      const wordId = `w_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const phonetic = extractPhonetic(mark.detail || '')
      const meaning = extractMeaning(mark.detail || '')
      const lemma = extractLemma(mark)
      const pos = extractPos(mark.detail || '')
      const wordText = lemma || mark.text.trim()
      const note = lemma && lemma !== mark.text.trim()
        ? `原文: ${mark.text.trim()}${mark.note ? '\n' + mark.note : ''}`
        : mark.note || ''

      db.run(
        `INSERT INTO words (id,bookId,word,phonetic,meaning,pos,note,source,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [wordId, bookId, wordText, phonetic, meaning, pos, note, row.id, now, now]
      )
      synced++
    }
  }
  stmt.free()

  if (synced > 0) await saveDb()

  return { synced, skipped }
})
