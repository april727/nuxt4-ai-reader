import { deepseekChat, deepseekStream, type DeepSeekMessage } from '../../utils/deepseek'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ messages: DeepSeekMessage[]; stream?: boolean; response_format?: { type: string }; thinking?: boolean }>(event)
  const isStreaming = body.stream !== false // 默认 true

  // 非流式：直接返回 JSON 结果
  if (!isStreaming) {
    const content = await deepseekChat(body.messages, {
      temperature: 0.3,
      maxTokens: 2000,
      responseFormat: body.response_format as any,
      thinking: body.thinking,
    })
    return { content }
  }

  const response = await deepseekStream(body.messages, {
    temperature: 0.2, // 降低温度，输出更稳定
    maxTokens: 5000, // 解释输出含逐句翻译+词汇表，需要更大空间避免截断
    responseFormat: body.response_format as any,
    thinking: body.thinking,
  })

  // 逐块转发 SSE（带行缓冲，处理跨 chunk 被切断的 SSE 行，避免内容丢失）
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = '' // 未完成行的缓冲
  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) { controller.close(); break }
          buffer += decoder.decode(value, { stream: true })
          // 按换行分割；最后一段可能不完整，保留在 buffer 等下一个 chunk 补齐
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const payload = trimmed.slice(5).trim() // 去掉 "data:" 前缀
            if (!payload || payload === '[DONE]') continue
            try {
              const json = JSON.parse(payload)
              const delta = json.choices?.[0]?.delta?.content
              if (delta) controller.enqueue(new TextEncoder().encode(delta))
            } catch {}
          }
        }
      } catch { controller.close() }
    },
  })

  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setHeader(event, 'Cache-Control', 'no-cache')
  // 关闭中间层缓冲，保证首字立即到达浏览器
  setHeader(event, 'X-Accel-Buffering', 'no')
  return stream
})
