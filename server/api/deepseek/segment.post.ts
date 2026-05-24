import type { Paragraph } from '#shared/types'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type SegmentType = 'document' | 'subtitle'

/** 句子结尾正则（中英文） */
const SENTENCE_END = /(?<=[.!?。！？"」])\s*/

/** 将文本按句子拆分 */
function splitSentences(text: string): string[] {
  return text.split(SENTENCE_END).map(s => s.trim()).filter(s => s.length > 0)
}

/** 本地兜底分段 */
function splitIntoParagraphs(text: string, type: SegmentType = 'document', size?: { minSentences: number; maxSentences: number }): Paragraph[] {
  const GROUP = size ? Math.round((size.minSentences + size.maxSentences) / 2) : (type === 'subtitle' ? 9 : 5)
  const raw = text.replace(/\s+/g, ' ').trim()
  const blocks = raw.split(/\n\s*\n/).filter(b => b.trim())
  if (blocks.length > 1) {
    return blocks.map((t, i) => ({ id: `f-${i}`, index: i, text: t.trim() }))
  }
  const sentenceEnd = /(?<=[.!?。！？"」])\s*/
  const sentences = raw.split(sentenceEnd).map(s => s.trim()).filter(s => s.length > 0)
  const result: Paragraph[] = []
  for (let i = 0; i < sentences.length; i += GROUP) {
    const chunk = sentences.slice(i, i + GROUP).join(' ').trim()
    if (chunk) result.push({ id: `f-${result.length}`, index: result.length, text: chunk })
  }
  if (result.length === 0) result.push({ id: 'f-0', index: 0, text: raw })
  return result
}

/**
 * 文本级去重：移除被后续长句包含的短片段（YouTube 滚动字幕残留）。
 * 纯本地处理，不消耗 API token。只适用于字幕类型。
 */
function deduplicateText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  let sentences = normalized
    .split(/(?<=[.!?。！？"」])\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 5)
  if (sentences.length <= 1) {
    sentences = normalized.split(/\n+/).map(s => s.trim()).filter(s => s.length > 20)
  }
  if (sentences.length <= 1) {
    sentences = []
    for (let i = 0; i < normalized.length; i += 50) {
      const chunk = normalized.slice(i, i + 50).trim()
      if (chunk) sentences.push(chunk)
    }
  }
  if (sentences.length <= 1) return text
  const cleaned: string[] = []
  for (let i = 0; i < sentences.length; i++) {
    const cur = sentences[i]
    let isFragment = false
    const windowEnd = Math.min(i + 1 + 8, sentences.length)
    for (let j = i + 1; j < windowEnd; j++) {
      const future = sentences[j]
      if (future.length > cur.length && future.toLowerCase().includes(cur.toLowerCase())) {
        isFragment = true
        break
      }
    }
    if (!isFragment) cleaned.push(cur)
  }
  return cleaned.join(' ').trim() || text
}

/** 后处理：合并过短段落到前后（尾部残片处理） */
function mergeTinyTails(segments: Paragraph[], minChars = 50): Paragraph[] {
  if (segments.length <= 1) return segments
  const last = segments[segments.length - 1]
  if (last.text.length < minChars && segments.length > 1) {
    const prev = segments[segments.length - 2]
    prev.text += ' ' + last.text
    return segments.slice(0, -1)
  }
  return segments
}

// 启动时加载 prompt 模板（一次读盘，常驻内存）
const segmentTemplate = readFileSync(resolve('prompt/segment.md'), 'utf-8')

function buildPrompt(inputText: string, overrides?: { minSentences: number; maxSentences: number }): string {
  const sizeRule = overrides
    ? `用户指定：每段 ${overrides.minSentences}-${overrides.maxSentences} 句。严格按照此范围分段，不参考内容类型。`
    : `根据内容类型自动决定（见下方对照表）。`

  return segmentTemplate
    .replace('{sizeRule}', sizeRule)
    .replace('{inputText}', inputText)
}

interface SegmentSize {
  minSentences: number
  maxSentences: number
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ text: string; type?: SegmentType; size?: SegmentSize }>(event)
  const segmentType: SegmentType = body.type || 'document'

  const apiKey = process.env.DEEPSEEK_API_KEY
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'

  if (!apiKey) {
    throw createError({ statusCode: 500, message: 'DEEPSEEK_API_KEY not configured' })
  }

  const rawText = segmentType === 'subtitle' ? deduplicateText(body.text) : body.text

  const maxInputChars = 15000
  const inputText = rawText.length > maxInputChars
    ? rawText.slice(0, maxInputChars) + '\n\n[全文共 ' + rawText.length + ' 字符，此处仅提供前 ' + maxInputChars + ' 字符]'
    : rawText

  const prompt = buildPrompt(inputText, body.size)

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
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 8000,
      },
    })

    const content = response.choices[0]?.message?.content || ''
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      throw new Error('Failed to parse AI response')
    }

    const raw = JSON.parse(jsonMatch[0]) as Array<{ index: number; text: string }>
    const segments: Paragraph[] = raw.map((s, i) => ({
      id: `p-${i}`,
      index: i,
      text: s.text,
    }))

    const cleaned = mergeTinyTails(segments)
    return cleaned.length > 0 ? cleaned : [{ id: 'p-0', index: 0, text: body.text }]
  } catch (err: any) {
    console.error(`[segment] AI 分段失败 (type=${segmentType}):`, err.message)
    return splitIntoParagraphs(body.text, segmentType, body.size)
  }
})
