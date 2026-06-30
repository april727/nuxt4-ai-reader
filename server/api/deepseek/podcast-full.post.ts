import { PROMPTS } from '../../utils/prompts'

/** 修复 AI 返回 JSON 中常见的语法错误 */
function repairJson(raw: string): string {
  let fixed = raw

  // 1. 去除 markdown 代码块标记
  fixed = fixed.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')

  // 2. 修复对象/数组元素之间缺少的逗号
  fixed = fixed.replace(/\}\s*\n\s*\{/g, '},\n{')
  fixed = fixed.replace(/([\]}"'])\s*\n\s*(["{[])/g, '$1,\n$2')

  // 3. 修复字符串后缺逗号接下一个键或值
  fixed = fixed.replace(/"\s*\n\s*"/g, '",\n"')
  fixed = fixed.replace(/"\s*\n\s*\{/g, '",\n{')

  // 4. 去除尾随逗号
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1')

  // 5. 修复未闭合的字符串：如果 JSON 末尾被截断在字符串中间，移除最后不完整的片段
  const lastQuote = fixed.lastIndexOf('"')
  const lastBrace = Math.max(fixed.lastIndexOf('}'), fixed.lastIndexOf(']'))
  if (lastQuote > lastBrace + 100) {
    fixed = fixed.slice(0, lastBrace + 1)
  }

  return fixed
}

interface PodcastResult {
  segments: Array<{ index: number; label: string; text: string }>
  analysis: string
  notes: string
}

/** 终极兜底：正则单独提取每个 segments 元素 + analysis + notes */
function extractFieldsFallback(raw: string): PodcastResult {
  const segments: PodcastResult['segments'] = []
  const segRegex = /\{\s*"index"\s*:\s*(\d+)\s*,\s*"label"\s*:\s*"([^"]*)"\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g
  let m
  while ((m = segRegex.exec(raw)) !== null) {
    segments.push({ index: parseInt(m[1]), label: m[2], text: m[3].replace(/\\"/g, '"').replace(/\\n/g, '\n') })
  }
  if (!segments.length) {
    // 更宽松的正则：用 "index" 之后的内容作为 text
    const looseRegex = /"index"\s*:\s*(\d+)\s*,\s*"label"\s*:\s*"([^"]+)"\s*,\s*"text"\s*:\s*"([\s\S]*?)"\s*(?=\}|,)/g
    while ((m = looseRegex.exec(raw)) !== null) {
      segments.push({ index: parseInt(m[1]), label: m[2], text: m[3].replace(/\\"/g, '"').replace(/\\n/g, '\n') })
    }
  }
  const analysisMatch = raw.match(/"analysis"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  const notesMatch = raw.match(/"notes"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  return {
    segments: segments.sort((a, b) => a.index - b.index),
    analysis: analysisMatch ? analysisMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : '',
    notes: notesMatch ? notesMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : '',
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ text: string }>(event)
  if (!body?.text?.trim()) throw createError({ statusCode: 400, message: '缺少文本内容' })

  const apiKey = process.env.DEEPSEEK_API_KEY
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'

  if (!apiKey) throw createError({ statusCode: 500, message: 'DEEPSEEK_API_KEY not configured' })

  const promptTemplate = PROMPTS['podcast_extract']

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
        max_tokens: 64000,
        response_format: { type: 'json_object' },
      },
    })

    const content = response.choices[0]?.message?.content || ''
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw createError({ statusCode: 500, message: 'AI 返回格式异常，未找到 JSON' })
    }

    let jsonStr = jsonMatch[0]
    let result: PodcastResult

    try {
      result = JSON.parse(jsonStr) as PodcastResult
    } catch (parseErr: any) {
      console.warn('[podcast-full] JSON 解析失败，尝试修复:', parseErr.message)
      jsonStr = repairJson(jsonStr)
      try {
        result = JSON.parse(jsonStr) as PodcastResult
      } catch (repairErr: any) {
        // 终极兜底：用正则分别提取各字段
        console.error('[podcast-full] JSON 修复后仍解析失败，尝试字段提取:', repairErr.message)
        try {
          result = extractFieldsFallback(content)
        } catch {
          console.error('[podcast-full] 原始内容 (前 500 字符):', content.slice(0, 500))
          throw createError({ statusCode: 500, message: 'AI 返回格式异常，JSON 解析失败' })
        }
      }
    }

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
