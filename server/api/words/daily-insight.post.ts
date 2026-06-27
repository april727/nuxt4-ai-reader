import { queryOne, queryAll, runQuery } from '../../utils/db'

async function callDeepSeek(messages: Array<{ role: string; content: string }>): Promise<string> {
  const config = useRuntimeConfig()
  const apiKey = config.deepseekApiKey || process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('API key 未配置')

  const resp = await fetch(`${process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      messages,
      temperature: 0.7,
      max_tokens: 2500,
    }),
  })
  if (!resp.ok) throw new Error(`DeepSeek error: ${resp.status}`)
  const json = await resp.json() as any
  return json.choices?.[0]?.message?.content || ''
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ date: string; force?: boolean }>(event)
  if (!body?.date) throw createError({ statusCode: 400 })

  // 检查缓存（非强制刷新时）
  if (!body.force) {
    const cached = await queryOne('SELECT content FROM daily_insights WHERE date=?', [body.date])
    if (cached?.content) return { content: cached.content }
  }

  // 预加载 pos 索引
  const posIndex = new Map<string, string>()
  const posRows = await queryAll('SELECT LOWER(word) as w, pos FROM words WHERE pos IS NOT NULL AND pos != \'\'')
  for (const r of posRows) {
    if (!posIndex.has(r.w as string)) posIndex.set(r.w as string, r.pos as string)
  }

  // 收集当日所有标记
  const words: string[] = []
  const phrases: string[] = []
  const sentences: string[] = []
  const textTitles = new Set<string>()
  const wordDetails: string[] = []

  const textRows = await queryAll(
    `SELECT id, title, marks FROM texts WHERE marks IS NOT NULL AND marks != '' AND marks != '[]'`
  )

  for (const row of textRows) {
    let marks: any[] = []
    try { marks = JSON.parse(row.marks) } catch { continue }

    for (const m of marks) {
      if (!m.id || !m.createdAt) continue
      if ((m.createdAt as string).slice(0, 10) !== body.date) continue

      textTitles.add(row.title as string)
      const text = (m.text || '').trim()

      if (m.type === 'word') {
        const pos = posIndex.get(text.toLowerCase()) || ''
        const meaning = extractBriefMeaning(m.detail)
        words.push(text)
        wordDetails.push(`${text}${pos ? ` (${pos})` : ''}${meaning ? ` — ${meaning}` : ''}`)
      } else if (m.type === 'phrase') {
        phrases.push(text)
      } else if (m.type === 'sentence') {
        sentences.push(text)
      }
    }
  }

  if (!words.length && !phrases.length && !sentences.length) {
    throw createError({ statusCode: 404, message: '当天无标记记录' })
  }

  const uniqueWords = [...new Set(words)]
  const uniquePhrases = [...new Set(phrases)]

  const wordList = wordDetails.slice(0, 60).join('\n')
  const sourceList = [...textTitles].join('、')

  const prompt = `你是一位英语学习导师。以下是学习者 ${body.date} 当天标记的学习内容：

## 生词 (${words.length}个，去重${uniqueWords.length}个)
${wordList || '（无）'}

## 短语 (${phrases.length}个)
${uniquePhrases.slice(0, 20).join('、') || '（无）'}

## 好句 (${sentences.length}句)
${sentences.slice(0, 3).map((s, i) => `${i + 1}. ${s.slice(0, 80)}`).join('\n') || '（无）'}

## 来源文章
${sourceList}

## 要求
请用中文写一段今天的"学习日报"，包含以下内容：

### 📊 今日概况
一句话概括今天的学习量。

### 🔍 词汇分析
- 这些词有什么共同主题或语义倾向？
- 挑 3-5 个最有趣的词，各用一两句话做拓展解释（词源、文化背景、有趣用法等）
- 如果有同根词或近义词关系，点出来

### 💡 学习建议
基于今天的词汇，给 2-3 条简短的学习建议。

### 🎯 趣味挑战（可选）
如果这些词适合编一个微型故事或场景，用一两句话给出一个创意设定。如果没有灵感就跳过。

要求：语气轻松有趣，像朋友聊天，不要过于学术化。总共控制在 400-600 字。`

  try {
    const content = await callDeepSeek([
      { role: 'system', content: '你是一位风趣的英语学习导师。用轻松的中文写作，像朋友聊天。' },
      { role: 'user', content: prompt },
    ])
    // 持久化保存
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
