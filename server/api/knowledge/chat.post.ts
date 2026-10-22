import { deepseekChat } from '../../utils/deepseek'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    messages: Array<{ role: string; content: string }>
    context?: string
  }>(event)

  if (!body.messages?.length) throw createError({ statusCode: 400, message: '缺少消息' })

  const msgs = [{ role: 'system', content: `你是一位知识管理助手。${body.context || ''}请用中文回复，简洁有条理。` }, ...body.messages]

  // 模型统一取 DEEPSEEK_MODEL（此前硬编码 deepseek-chat，绕过了全局配置）
  const content = await deepseekChat(msgs, { temperature: 0.7, maxTokens: 2000 })

  return { content: content || '(无回复)' }
})
