import { queryAll, queryOne, runQuery } from '../../utils/db'
import { extractPhonetic, extractMeaning, extractPos, extractImage } from '../../utils/marksSync'

/**
 * 历史数据回填（一次性维护接口）
 *
 * 早期词条在 AI 回填解析之前就写入 words，导致 detail/释义/音标为空。
 * 这里以 texts.marks（事实源）为准，把 detail、所在句、配图、markId 补进 words，
 * 只填空字段，不覆盖用户已编辑的释义和学习进度。
 *
 * 分批执行：每次最多处理 limit 个词条，返回 remaining 供继续调用。
 */
const MARK_TO_BOOK: Record<string, string> = {
  word: 'wb_default',
  phrase: 'wb_phrases',
  sentence: 'wb_sentences',
}

function sentenceAt(text: string, start: number, end: number): string {
  if (!text) return ''
  const isBoundary = (ch: string) => /[.!?。！？\n]/.test(ch)
  let s = Math.max(0, start)
  let e = Math.min(text.length, end)
  while (s > 0 && !isBoundary(text[s - 1])) s--
  while (e < text.length && !isBoundary(text[e])) e++
  if (e < text.length && /[.!?。！？]/.test(text[e])) e++
  return text.slice(s, e).replace(/\s+/g, ' ').trim().slice(0, 400)
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ limit?: number; dryRun?: boolean }>(event).catch(() => ({} as any))
  const limit = Math.min(Math.max(Number(body?.limit) || 800, 1), 5000)
  const dryRun = Boolean(body?.dryRun)

  const texts = await queryAll(
    `SELECT id, segments, marks FROM texts WHERE marks IS NOT NULL AND marks != '' AND marks != '[]' AND deletedAt IS NULL`
  )

  let scanned = 0
  let updated = 0
  let missingWord = 0
  let hasMore = false

  outer:
  for (const t of texts) {
    let marks: any[] = []
    let segments: any[] = []
    try { marks = JSON.parse(t.marks) } catch { continue }
    try { segments = JSON.parse(t.segments || '[]') } catch {}

    for (const mark of marks) {
      if (!mark?.id || mark.deletedAt) continue
      const bookId = MARK_TO_BOOK[mark.type]
      if (!bookId) continue

      if (updated >= limit) { hasMore = true; break outer }
      scanned++

      const lemma = (mark.lemma || '').trim()
      const wordText = lemma || (mark.text || '').trim()
      if (!wordText) continue

      let word = await queryOne('SELECT * FROM words WHERE markId=?', [mark.id])
      if (!word) word = await queryOne('SELECT * FROM words WHERE bookId=? AND LOWER(word)=LOWER(?)', [bookId, wordText])
      if (!word) { missingWord++; continue }
      // 已从单词本移除的词条保持墓碑状态，不参与回填
      if (word.dismissedAt) continue

      const detail = mark.detail || ''
      const paragraph = segments.find((s: any) => s.id === mark.paragraphId)
      const context = mark.context
        || (paragraph?.text ? sentenceAt(paragraph.text, Number(mark.startOffset) || 0, Number(mark.endOffset) || 0) : '')
      const image = mark.image || extractImage(detail)
      const markType = mark.type || 'word'
      const paragraphId = mark.paragraphId || ''
      const startOffset = Number(mark.startOffset) || 0
      const endOffset = Number(mark.endOffset) || 0

      const patch: Record<string, any> = {}
      if (word.markId !== mark.id) patch.markId = mark.id
      if (detail && word.detail !== detail) patch.detail = detail
      if (context && word.context !== context) patch.context = context
      if (image && word.image !== image) patch.image = image
      if (markType && word.type !== markType) patch.type = markType
      if (paragraphId && word.paragraphId !== paragraphId) patch.paragraphId = paragraphId
      if (Number(word.startOffset) !== startOffset) patch.startOffset = startOffset
      if (Number(word.endOffset) !== endOffset) patch.endOffset = endOffset
      if (!word.phonetic) { const v = extractPhonetic(detail); if (v) patch.phonetic = v }
      if (!word.meaning) { const v = extractMeaning(detail); if (v) patch.meaning = v }
      if (!word.pos) { const v = extractPos(detail); if (v) patch.pos = v }

      const keys = Object.keys(patch)
      if (!keys.length) continue

      if (!dryRun) {
        await runQuery(
          `UPDATE words SET ${keys.map(k => `${k}=?`).join(',')},updatedAt=? WHERE id=?`,
          [...keys.map(k => patch[k]), new Date().toISOString(), word.id],
        )
      }
      updated++
    }
  }

  return { scanned, updated, missingWord, hasMore, dryRun }
})
