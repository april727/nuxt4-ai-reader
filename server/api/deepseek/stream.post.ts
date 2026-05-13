export default defineEventHandler(async (event) => {
  const body = await readBody<{ messages: Array<{ role: string; content: string }> }>(event)

  const apiKey = process.env.DEEPSEEK_API_KEY
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'

  if (!apiKey) throw createError({ statusCode: 500, statusMessage: 'DEEPSEEK_API_KEY not configured' })

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: body.messages, stream: true, temperature: 0.5, max_tokens: 3000 }),
  })

  if (!response.ok || !response.body) {
    throw createError({ statusCode: 502, statusMessage: 'DeepSeek API error' })
  }

  // 逐块转发 SSE
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) { controller.close(); break }
          const text = decoder.decode(value, { stream: true })
          // 解析 SSE 行，只提取 content delta
          for (const line of text.split('\n')) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const json = JSON.parse(line.slice(6))
                const delta = json.choices?.[0]?.delta?.content
                if (delta) controller.enqueue(new TextEncoder().encode(delta))
              } catch {}
            }
          }
        }
      } catch { controller.close() }
    }
  })

  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setHeader(event, 'Cache-Control', 'no-cache')
  return stream
})
