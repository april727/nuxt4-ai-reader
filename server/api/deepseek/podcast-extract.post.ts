import { getPromptTemplate } from '../../utils/promptManager'
import { deepseekChat } from '../../utils/deepseek'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ text: string }>(event)
  if (!body?.text?.trim()) throw createError({ statusCode: 400, message: '缺少文本内容' })

  // 从 Prompt 管理器获取模板（失败时自动降级到本地常量）
  const promptTemplate = await getPromptTemplate('podcast_extract')

  // 截断输入，留足 token 给 prompt
  const maxTextChars = 12000
  const inputText = body.text.length > maxTextChars
    ? body.text.slice(0, maxTextChars) + '\n\n[全文共 ' + body.text.length + ' 字符，仅提供前 ' + maxTextChars + ' 字符]'
    : body.text

  const fullPrompt = promptTemplate + '\n\n## 待整理文本\n\n' + inputText

  try {
    const content = await deepseekChat(
      [{ role: 'user', content: fullPrompt }],
      { temperature: 0.3, maxTokens: 6000 },
    )
    return { summary: content }
  } catch (err: any) {
    console.error('[podcast-extract] DeepSeek 调用失败:', err.message)
    throw createError({ statusCode: 502, message: 'DeepSeek API 调用失败' })
  }
})
