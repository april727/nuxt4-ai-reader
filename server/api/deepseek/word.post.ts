import type { WordLookupRequest, WordDetail } from '#shared/types'
import { deepseekChat } from '../../utils/deepseek'

export default defineEventHandler(async (event) => {
  const body = await readBody<WordLookupRequest>(event)

  const contextLine = body.context ? `\n该单词出现在以下语境中：${body.context}` : ''

  const prompt = `查询以下单词：${body.word}${contextLine}

输出 JSON，不要任何其他文字：
{
  "word": "单词本身",
  "phonetic": "英式音标，如 /ˈfæntəsi/",
  "definition": "中文释义（包含词性和主要含义，50字以内）",
  "example": "一个英文例句",
  "pos": "词性缩写如 n./v./adj./adv."
}`

  const content = await deepseekChat(
    [
      { role: 'system', content: '你是英语词典。只输出严格 JSON，不要问候语、开场白、解释或 Markdown。' },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.1, maxTokens: 800, responseFormat: { type: 'json_object' } },
  )

  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw createError({ statusCode: 500, message: 'Failed to parse AI response' })
  }

  return JSON.parse(jsonMatch[0]) as WordDetail
})
