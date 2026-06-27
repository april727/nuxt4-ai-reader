import { queryAll } from '../../utils/db'

// 对 DeepSeek 进行 HTTP 调用（服务端环境）
async function callDeepSeek(messages: Array<{ role: string; content: string }>): Promise<string> {
  const config = useRuntimeConfig()
  const apiKey = config.deepseekApiKey || process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DeepSeek API key 未配置')

  const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      temperature: 0.7,
      max_tokens: 3000,
    }),
  })

  if (!resp.ok) throw new Error(`DeepSeek API error: ${resp.status}`)
  const json = await resp.json() as any
  return json.choices?.[0]?.message?.content || ''
}

export default defineEventHandler(async () => {
  // 获取全部词汇
  const rows = await queryAll('SELECT word, meaning, pos, phase FROM words ORDER BY createdAt DESC')

  if (!rows.length) throw createError({ statusCode: 404, message: '暂无词汇数据' })

  // 构建词汇列表（去重，取前 500 个给 AI 分析）
  const seen = new Set<string>()
  const uniqueWords: string[] = []
  for (const r of rows) {
    const key = r.word.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      uniqueWords.push(`${r.word}${r.pos ? ` (${r.pos})` : ''}${r.meaning ? ` — ${r.meaning}` : ''}`)
    }
  }
  const wordList = uniqueWords.slice(0, 500).join('\n')

  const prompt = `你是一位词汇分析专家。下面是一个语言学习者的全部词汇列表（约${uniqueWords.length}个词汇）。请分析这些词汇的语义分布，并给出聚类结果和主题推荐。

## 词汇列表
${wordList}

## 分析要求
1. **语义聚类**：将这些词汇按语义类别分为 4-8 个组（如：科技/学术、情感/心理、社会/人际、自然/具象、动作/行为、抽象/哲理等），每组给出标签、数量统计、5 个代表性词汇示例。
2. **总结**：一段 50-100 字的中文总结，概括这些词汇的整体特征（如倾向抽象还是具象、偏向哪个语域等）。
3. **主题推荐**：基于词汇的语义分布，推荐 3-5 个可以自然融入较多词汇的故事/文章主题。每个主题包含：标题、叙事风格、一句话描述。

## 输出格式
请直接输出以下 JSON（不要用代码块包裹）：

{
  "summary": "...",
  "groups": [
    { "label": "科技/学术", "count": 120, "sampleWords": ["word1", "word2", "word3", "word4", "word5"] }
  ],
  "themes": [
    { "title": "深海遗民", "style": "科幻悬疑", "description": "海底科考站发现了..." }
  ]
}`

  try {
    const content = await callDeepSeek([
      { role: 'system', content: '你是一位词汇分析专家。只输出 JSON，不要代码块标记。' },
      { role: 'user', content: prompt },
    ])

    // 尝试解析 JSON（清理可能的 markdown 标记）
    const cleaned = content
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim()
    const result = JSON.parse(cleaned)
    return result
  } catch (err: any) {
    console.error('AI 聚类分析失败:', err.message)
    throw createError({ statusCode: 500, message: 'AI 分析失败，请稍后重试' })
  }
})
