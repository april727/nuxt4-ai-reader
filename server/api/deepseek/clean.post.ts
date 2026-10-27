import { getPromptMessages } from '../../utils/promptManager'
import { deepseekChat } from '../../utils/deepseek'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ text: string }>(event)
  if (!body?.text?.trim()) throw createError({ statusCode: 400, message: '文本为空' })

  // 从 Prompt 管理器获取模板（失败时降级到本地常量）
  const { system, user } = await getPromptMessages('clean', { inputText: body.text })

  const content = await deepseekChat(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { temperature: 0.1, maxTokens: 4096 },
  )

  return { cleaned: content.trim() }
})
