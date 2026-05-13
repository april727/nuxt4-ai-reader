import type { ParagraphActionRequest } from '#shared/types'

export default defineEventHandler(async (event) => {
  const body = await readBody<ParagraphActionRequest>(event)

  const apiKey = process.env.DEEPSEEK_API_KEY
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'

  if (!apiKey) {
    throw createError({ statusCode: 500, statusMessage: 'DEEPSEEK_API_KEY not configured' })
  }

  const prompt = `你是一位专业翻译。请将以下段落翻译成流畅自然的中文。

忠实原文，保持原文的语气和风格。只输出翻译结果，不要添加任何解释、注释或额外内容。

待翻译段落：
${body.paragraph}`

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
      max_tokens: 1500,
    },
  })

  return { content: response.choices[0]?.message?.content || '' }
})
