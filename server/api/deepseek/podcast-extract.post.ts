import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ text: string }>(event)
  if (!body?.text?.trim()) throw createError({ statusCode: 400, message: '缺少文本内容' })

  const apiKey = process.env.DEEPSEEK_API_KEY
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'

  if (!apiKey) throw createError({ statusCode: 500, message: 'DEEPSEEK_API_KEY not configured' })

  // 读取 prompt 模板
  const promptPath = resolve('prompt/podcast_extract.md')
  let promptTemplate: string
  try {
    promptTemplate = readFileSync(promptPath, 'utf-8')
  } catch {
    throw createError({ statusCode: 500, message: 'prompt/podcast_extract.md 文件不存在' })
  }

  // 截断输入，留足 token 给 prompt
  const maxTextChars = 12000
  const inputText = body.text.length > maxTextChars
    ? body.text.slice(0, maxTextChars) + '\n\n[全文共 ' + body.text.length + ' 字符，仅提供前 ' + maxTextChars + ' 字符]'
    : body.text

  const fullPrompt = promptTemplate + '\n\n## 待整理文本\n\n' + inputText

  try {
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
        messages: [{ role: 'user', content: fullPrompt }],
        temperature: 0.3,
        max_tokens: 6000,
      },
    })

    const content = response.choices[0]?.message?.content || ''
    return { summary: content }
  } catch (err: any) {
    console.error('[podcast-extract] DeepSeek 调用失败:', err.message)
    throw createError({ statusCode: 502, message: 'DeepSeek API 调用失败' })
  }
})
