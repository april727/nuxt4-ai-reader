import type { ChatRequest, ChatMessage } from '#shared/types'
import { deepseekChat } from '../../utils/deepseek'

export default defineEventHandler(async (event) => {
  const body = await readBody<ChatRequest>(event)

  const systemParts = [
    '你是一位专注、博学的阅读导师。你正在和用户讨论文章中一个具体段落的内容。',
    '请紧密围绕当前段落的原文和分析来回答问题。',
    '如果用户的问题超出当前段落范围，你可以基于自己的知识补充，但要说明哪些信息来自段落之外。',
    '回答使用简洁清晰的 Markdown 格式。',
  ]

  if (body.articleContext) {
    systemParts.push(`## 文章背景\n${body.articleContext}`)
  }
  if (body.paragraphContext) {
    systemParts.push(`## 当前段落及其分析\n${body.paragraphContext}`)
  }

  const systemMessage: ChatMessage = {
    role: 'system',
    content: systemParts.join('\n\n'),
  }

  const content = await deepseekChat([systemMessage, ...body.messages], {
    temperature: 0.7,
    maxTokens: 2000,
  })

  return { content }
})
