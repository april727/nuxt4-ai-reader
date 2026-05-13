import type { SegmentRequest, Paragraph } from '#shared/types'

export default defineEventHandler(async (event) => {
  const body = await readBody<SegmentRequest>(event)

  const apiKey = process.env.DEEPSEEK_API_KEY
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'

  if (!apiKey) {
    throw createError({ statusCode: 500, statusMessage: 'DEEPSEEK_API_KEY not configured' })
  }

  const prompt = `你是一位文本分段专家。请将以下文本智能分段，遵循以下规则：

1. 每个段落通常包含1-2句话
2. 如果一个句子较长（超过30个字），则独立成段
3. 保持语义连贯性，相关的内容放在同一段
4. 段落长度尽量均衡，避免有的段过长、有的过短
5. 按原文顺序输出

请用 JSON 数组格式输出，每个元素包含：
- index: 段落序号（从0开始）
- text: 段落文本

文本内容：
${body.text}

请严格按照 JSON 数组格式输出：
[
  { "index": 0, "text": "段落1..." },
  { "index": 1, "text": "段落2..." }
]`

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
      max_tokens: 4000,
    },
  })

  const content = response.choices[0]?.message?.content || ''
  const jsonMatch = content.match(/\[[\s\S]*\]/)
  if (!jsonMatch) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to parse AI response' })
  }

  const segments = JSON.parse(jsonMatch[0]) as Array<{ index: number; text: string }>
  return segments.map((s) => ({
    id: `p-${s.index}`,
    index: s.index,
    text: s.text,
  })) as Paragraph[]
})
