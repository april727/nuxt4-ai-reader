export default defineEventHandler(async (event) => {
  const body = await readBody<{ text: string; title?: string }>(event)

  const apiKey = process.env.DEEPSEEK_API_KEY
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'

  if (!apiKey) throw createError({ statusCode: 500, message: 'DEEPSEEK_API_KEY not configured' })
  if (!body?.text?.trim()) throw createError({ statusCode: 400, message: '缺少文本内容' })

  // 只送前 8000 字符做快速摘要（比完整分析 15000 更少，响应更快）
  const inputText = body.text.length > 8000
    ? body.text.slice(0, 8000)
    : body.text

  const prompt = `你是一位专业的内容摘要助手。请为以下文章生成简洁摘要，用 JSON 格式输出。

要求：
- summary: 核心内容，2-3 句话（中文，80-150 字）
- title: 简洁标题（15 字以内）
- tags: 2-4 个关键词标签

文章标题: ${body.title || '未知'}
文章内容:
${inputText}

请严格输出 JSON（不要其他内容）：
{"title":"...","summary":"...","tags":["...","..."]}`

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
      max_tokens: 512,
    },
  })

  const content = response.choices[0]?.message?.content || ''
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw createError({ statusCode: 500, message: 'AI 响应解析失败' })

  try {
    return JSON.parse(jsonMatch[0])
  } catch {
    throw createError({ statusCode: 500, message: 'AI 返回格式异常' })
  }
})
