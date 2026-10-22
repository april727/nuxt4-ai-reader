import type { ParagraphActionRequest } from '#shared/types'
import { getPromptMessages } from '../../utils/promptManager'
import { deepseekChat } from '../../utils/deepseek'

export default defineEventHandler(async (event) => {
  const body = await readBody<ParagraphActionRequest>(event)

  // 从 Prompt 管理器获取模板（失败时降级到本地常量）
  const { system, user } = await getPromptMessages('translate', { paragraph: body.paragraph })

  const content = await deepseekChat(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { temperature: 0.3, maxTokens: 1500 },
  )

  return { content }
})
