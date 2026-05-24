import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface PodcastResult {
  segments: Array<{ index: number; label: string; text: string }>
  analysis: string
  notes: string
}

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

  const fullPrompt = promptTemplate + '\n' + body.text

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
        temperature: 0.2,
        max_tokens: 8000,
      },
    })

    const content = response.choices[0]?.message?.content || ''
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw createError({ statusCode: 500, message: 'AI 返回格式异常，未找到 JSON' })
    }
    const result = JSON.parse(jsonMatch[0]) as PodcastResult

    if (!result.segments?.length) {
      throw createError({ statusCode: 500, message: 'AI 返回的分段为空' })
    }

    return result
  } catch (err: any) {
    // JSON 解析失败时尝试兜底修复
    if (err.message?.includes('JSON')) {
      console.error('[podcast-full] JSON 解析失败，原始内容:', err.message)
      throw createError({ statusCode: 500, message: 'AI 返回格式异常，请重试' })
    }
    throw err
  }
})
