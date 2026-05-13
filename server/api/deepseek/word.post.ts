import type { WordLookupRequest, WordDetail } from '#shared/types'

export default defineEventHandler(async (event) => {
  const body = await readBody<WordLookupRequest>(event)

  const apiKey = process.env.DEEPSEEK_API_KEY
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'

  if (!apiKey) {
    throw createError({ statusCode: 500, statusMessage: 'DEEPSEEK_API_KEY not configured' })
  }

  const contextLine = body.context ? `\n该单词出现在以下语境中：${body.context}` : ''

  const prompt = `你是一位英语词典专家。请查询以下单词的详细信息。

单词：${body.word}${contextLine}

请用 JSON 格式输出：
{
  "word": "单词本身",
  "phonetic": "英式音标，如 /ˈfæntəsi/",
  "definition": "中文释义（包含词性和主要含义，50字以内）",
  "example": "一个例句（英文），展示该词的使用方式"
}

请严格按照 JSON 格式输出，不要包含其他内容。`

  const response = await $fetch<{
    choices: Array<{ message: { content: string } }>
  }>(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 500,
    },
  })

  const content = response.choices[0]?.message?.content || ''
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to parse AI response' })
  }

  return JSON.parse(jsonMatch[0]) as WordDetail
})
