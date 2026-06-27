import { queryAll, runQuery } from '../../../../utils/db'

// 从 mark.detail 中提取字段
function extractPhonetic(detail: string): string {
  const m = detail.match(/\[PHONETIC\]\s*\/([^/]+)\/\s*\[\/PHONETIC\]/)
  return m?.[1] || ''
}

function extractMeaning(detail: string): string {
  const m = detail.match(/###\s*基本释义\s*\n+([\s\S]*?)(?=\n###|\n\[PHONETIC\]|\n\[LEMMA\]|$)/)
  if (!m) return ''
  return m[1]
    .replace(/^[-*]\s*/gm, '')
    .replace(/\n+/g, '；')
    .trim()
    .slice(0, 120)
}

function extractLemma(detail: string): string {
  const m = detail.match(/\[LEMMA\]\/(.+?)\/\[\/LEMMA\]/)
  return m?.[1]?.trim() || ''
}

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  const { wordIds } = await readBody<{ wordIds?: string[] }>(event)
  if (!bookId) throw createError({ statusCode: 400 })

  // 1. 获取本单词本中无含义的词条
  const allWords = await queryAll('SELECT id, word, meaning FROM words WHERE bookId=?', [bookId])
  const targets: Array<{ id: string; word: string }> = []
  for (const w of allWords) {
    if (wordIds?.length) {
      if (wordIds.includes(w.id as string)) targets.push({ id: w.id as string, word: w.word as string })
    } else if (!(w.meaning as string)?.trim()) {
      targets.push({ id: w.id as string, word: w.word as string })
    }
  }

  if (!targets.length) return { enriched: 0, total: 0 }

  // 2. 读取所有有标记的文本，建立 词文本 → mark.detail 的索引
  const textRows = await queryAll(
    `SELECT marks FROM texts WHERE marks IS NOT NULL AND marks != '' AND marks != '[]'`
  )
  const markIndex = new Map<string, { phonetic: string; meaning: string; lemma: string }>()

  for (const row of textRows) {
    let marks: any[] = []
    try { marks = JSON.parse(row.marks) } catch { continue }
    for (const mark of marks) {
      if (!mark.text || !mark.detail || mark.type === 'note') continue
      const key = mark.text.trim().toLowerCase()
      if (!markIndex.has(key)) {
        markIndex.set(key, {
          phonetic: extractPhonetic(mark.detail),
          meaning: extractMeaning(mark.detail),
          lemma: extractLemma(mark.detail),
        })
      }
    }
  }

  // 3. 用已有数据补全词条
  const now = new Date().toISOString()
  let enriched = 0

  for (const t of targets) {
    const info = markIndex.get(t.word.trim().toLowerCase())
    if (!info) {
      // 也尝试用原词匹配
      const lemmaInfo = markIndex.get(
        t.word.replace(/[^a-zA-Z]/g, '').toLowerCase()
      )
      if (!lemmaInfo) continue
    }

    const data = info || markIndex.get(t.word.replace(/[^a-zA-Z]/g, '').toLowerCase())!
    await runQuery(
      `UPDATE words SET phonetic=?, meaning=?, updatedAt=? WHERE id=? AND bookId=?`,
      [data.phonetic, data.meaning, now, t.id, bookId]
    )
    enriched++
  }

  return { enriched, total: targets.length }
})
