export default defineEventHandler(async (event) => {
  const body = await readBody<{
    messages: Array<{ role: string; content: string }>
    context?: string
  }>(event)

  if (!body.messages?.length) throw createError({ statusCode: 400, message: '缺少消息' })

  const apiKey = process.env.DEEPSEEK_API_KEY
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'

  if (!apiKey) throw createError({ statusCode: 500, message: 'DEEPSEEK_API_KEY not configured' })

  const msgs = [{ role: 'system', content: `你是一位知识管理助手。${body.context || ''}请用中文回复，简洁有条理。` }, ...body.messages]

  const response = await $fetch<{ choices: Array<{ message: { content: string } }> }>(
    `${baseUrl}/v1/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: { model: 'deepseek-chat', messages: msgs, temperature: 0.7, max_tokens: 2000 },
    }
  )

  return { content: response.choices[0]?.message?.content || '(无回复)' }
})
