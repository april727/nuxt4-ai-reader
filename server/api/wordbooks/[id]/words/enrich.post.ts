import { getDb, saveDb } from '../../../../utils/db'

function extractPhonetic(detail: string): string {
  const m = detail.match(/\[PHONETIC\]\s*\/([^/]+)\/\s*\[\/PHONETIC\]/)
  return m?.[1] || ''
}

function extractMeaning(detail: string): string {
  const m = detail.match(/###\s*基本释义\s*\n+([\s\S]*?)(?=\n###|\n\[PHONETIC\]|\n\[LEMMA\]|$)/)
  if (!m) return ''
  return m[1].replace(/^[-*]\s*/gm, '').replace(/\n+/g, '；').trim().slice(0, 120)
}

function extractLemma(detail: string): string {
  const m = detail.match(/\[LEMMA\]\/(.+?)\/\[\/LEMMA\]/)
  return m?.[1]?.trim() || ''
}

// 从已有标记中查找词的释义
function lookupFromMarks(db: any, wordText: string): { phonetic: string; meaning: string; lemma: string } | null {
  const textStmt = db.prepare(
    `SELECT marks FROM texts WHERE marks IS NOT NULL AND marks != '' AND marks != '[]'`
  )
  const key = wordText.trim().toLowerCase()
  while (textStmt.step()) {
    const row = textStmt.getAsObject()
    let marks: any[] = []
    try { marks = JSON.parse(row.marks) } catch { continue }
    for (const mark of marks) {
      if (!mark.text || !mark.detail || mark.type === 'note') continue
      if (mark.text.trim().toLowerCase() === key) {
        textStmt.free()
        return {
          phonetic: extractPhonetic(mark.detail),
          meaning: extractMeaning(mark.detail),
          lemma: extractLemma(mark.detail),
        }
      }
    }
  }
  textStmt.free()
  return null
}

// DeepSeek 兜底（仅手动添加的词）
async function queryAI(word: string): Promise<{ phonetic: string; meaning: string; example: string; pos: string } | null> {
  const prompt = `为英文单词"${word}"提供信息。只返回JSON：
{"phonetic":"/IPA/","meaning":"中文释义（含词性标记如 adj. 或 v.）","example":"英文例句","pos":"词性缩写如 n./v./adj./adv."}`

  try {
    const res = await $fetch<{ choices: { message: { content: string } }[] }>(
      `${process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'}/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: {
          model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
          messages: [
            { role: 'system', content: '只返回JSON。' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3, max_tokens: 400,
          response_format: { type: 'json_object' },
        },
      }
    )
    const content = res.choices?.[0]?.message?.content || ''
    const m = content.match(/\{[\s\S]*\}/)
    return m ? JSON.parse(m[0]) : null
  } catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  const { wordId } = await readBody<{ wordId: string }>(event)
  if (!bookId || !wordId) throw createError({ statusCode: 400 })

  const db = await getDb()
  const stmt = db.prepare('SELECT * FROM words WHERE id=? AND bookId=?')
  stmt.bind([wordId, bookId])
  if (!stmt.step()) { stmt.free(); throw createError({ statusCode: 404 }) }
  const word = stmt.getAsObject()
  stmt.free()

  // 1. 先从已有标记中查找（零 API 调用）
  const cached = lookupFromMarks(db, word.word as string)
  let phonetic = cached?.phonetic || ''
  let meaning = cached?.meaning || ''
  let example = ''
  let pos = ''
  let fromAI = false

  // 2. 没找到才调 DeepSeek（手动添加的词）
  if (!meaning) {
    const ai = await queryAI(word.word as string)
    if (ai) {
      phonetic = ai.phonetic
      meaning = ai.meaning
      example = ai.example
      pos = ai.pos || ''
      fromAI = true
    }
  }

  if (!meaning) throw createError({ statusCode: 500, message: '未找到该词的释义' })

  const now = new Date().toISOString()
  db.run(
    `UPDATE words SET phonetic=?, meaning=?, example=?, pos=?, updatedAt=? WHERE id=? AND bookId=?`,
    [phonetic, meaning, example, pos, now, wordId, bookId]
  )
  await saveDb()

  return { wordId, phonetic, meaning, example, pos, fromAI }
})
