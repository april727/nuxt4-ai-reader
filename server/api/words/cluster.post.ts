import { queryAll } from '../../utils/db'
import { getPromptMessages } from '../../utils/promptManager'
import { deepseekChat } from '../../utils/deepseek'

// 对 DeepSeek 进行调用（模型与网关走统一配置）
async function callDeepSeek(messages: Array<{ role: string; content: string }>): Promise<string> {
  return deepseekChat(messages, { temperature: 0.7, maxTokens: 3000 })
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

  // 从 Prompt 管理器获取模板（失败时降级到本地常量）
  const { system, user } = await getPromptMessages('word-cluster', {
    wordCount: String(uniqueWords.length),
    wordList,
  })

  try {
    const content = await callDeepSeek([
      { role: 'system', content: system },
      { role: 'user', content: user },
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
