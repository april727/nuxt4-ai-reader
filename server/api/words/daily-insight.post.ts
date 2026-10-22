import { queryOne, queryAll, runQuery } from '../../utils/db'
import { getPromptMessages } from '../../utils/promptManager'
import { deepseekChat } from '../../utils/deepseek'

async function callDeepSeek(messages: Array<{ role: string; content: string }>): Promise<string> {
  return deepseekChat(messages, { temperature: 0.7, maxTokens: 2500 })
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ date: string; force?: boolean }>(event)
  if (!body?.date) throw createError({ statusCode: 400 })

  // 检查缓存
  if (!body.force) {
    const cached = await queryOne('SELECT content FROM daily_insights WHERE date=?', [body.date])
    if (cached?.content) return { content: cached.content }
  }

  // 从 words 表加载词性索引
  const posIndex = new Map<string, string>()
  const posRows = await queryAll('SELECT LOWER(word) as w, pos FROM words WHERE pos IS NOT NULL AND pos != \'\'')
  for (const r of posRows) {
    if (!posIndex.has(r.w as string)) posIndex.set(r.w as string, r.pos as string)
  }

  // 从 marks 表读取当日所有标记（排除软删除）
  const rows = await queryAll(
    'SELECT text, type, detail, textTitle FROM marks WHERE date(createdAt) = ? AND deletedAt IS NULL ORDER BY type, text',
    [body.date]
  )

  if (!rows.length) {
    throw createError({ statusCode: 404, message: '当天无标记记录' })
  }

  const words: string[] = []
  const phrases: string[] = []
  const sentences: string[] = []
  const textTitles = new Set<string>()
  const wordDetails: string[] = []

  for (const row of rows) {
    const text = (row.text as string).trim()
    const type = row.type as string
    const title = row.textTitle as string
    if (title) textTitles.add(title)

    if (type === 'word') {
      const pos = posIndex.get(text.toLowerCase()) || ''
      const meaning = extractBriefMeaning(row.detail as string)
      words.push(text)
      wordDetails.push(`${text}${pos ? ` (${pos})` : ''}${meaning ? ` — ${meaning}` : ''}`)
    } else if (type === 'phrase') {
      phrases.push(text)
    } else if (type === 'sentence') {
      sentences.push(text)
    }
  }

  const uniqueWords = [...new Set(words)]
  const uniquePhrases = [...new Set(phrases)]

  const wordList = wordDetails.slice(0, 60).join('\n')
  const sourceList = [...textTitles].join('、')

  // 从 Prompt 管理器获取模板（失败时降级到本地常量）
  const { system, user } = await getPromptMessages('daily-insight', {
    date: body.date,
    wordCount: String(words.length),
    uniqueWordCount: String(uniqueWords.length),
    wordList: wordList || '（无）',
    phraseCount: String(phrases.length),
    phraseList: uniquePhrases.slice(0, 20).join('、') || '（无）',
    sentenceCount: String(sentences.length),
    sentenceList: sentences.slice(0, 3).map((s, i) => `${i + 1}. ${s.slice(0, 80)}`).join('\n') || '（无）',
    sourceList,
  })

  try {
    const content = await callDeepSeek([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ])
    await runQuery('INSERT OR REPLACE INTO daily_insights (date, content, createdAt) VALUES (?,?,?)', [
      body.date, content, new Date().toISOString(),
    ])
    return { content }
  } catch (err: any) {
    console.error('AI insight failed:', err.message)
    throw createError({ statusCode: 500, message: 'AI 分析失败' })
  }
})

function extractBriefMeaning(detail: string): string {
  if (!detail) return ''
  const m = detail.match(/###\s*基本释义\s*\n+([\s\S]*?)(?=\n###|$)/)
  if (!m) return ''
  return m[1].replace(/^[-*]\s*/gm, '').replace(/\n+/g, '；').trim().slice(0, 40)
}
