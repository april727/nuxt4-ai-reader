import type { AnalyzeRequest } from '#shared/types'

export default defineEventHandler(async (event) => {
  const body = await readBody<AnalyzeRequest>(event)

  const apiKey = process.env.DEEPSEEK_API_KEY
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'

  if (!apiKey) {
    throw createError({ statusCode: 500, message: 'DEEPSEEK_API_KEY not configured' })
  }

  // 截断输入，只取前 15000 字符送给 AI（超长书原文会超出 token 限制）
  const maxInputChars = 15000
  const inputText = body.text.length > maxInputChars
    ? body.text.slice(0, maxInputChars) + '\n\n[全文共 ' + body.text.length + ' 字符，此处仅提供前 ' + maxInputChars + ' 字符用于分析]'
    : body.text

  // 预分割原文为句子数组，AI 返回断点索引即可
  const sentences = splitSentences(body.text)

  const prompt = `你是一位专业的内容分析助手。请一次性完成两项任务，用 JSON 输出。

## 任务一：分析全文
- title: 简洁标题（10字以内）
- summary: 核心内容概括（100-200字）
- background: 写作背景、上下文和场景分析（100-200字）
- tone: 语气/风格（学术/科普/叙事/议论等）
- keyPoints: 提取3-5个关键要点，每个一句话

## 任务二：智能分段
以下文本已被预分割为单句序列，共 ${sentences.length} 句。
请选择哪些句子之后需要分段，输出 breakAfter 数组（值为句子 index，表示在该句之后插入段落分隔）。

### 分段规则
- **段落长度控制**：每段通常 1~3 句。总句数 ≥ 6 时，避免出现超过 4 句的段落。如果连续 3 句以上都是短句（< 30 字），请在它们之间适当断开。
- **保持合理段落**：超长句（超过 60 字）可独立成段；相关主题的 2~3 句合并为一段。
- **识别分段线索**：如果句子序列中存在明显的段落标题（如 \`##\`、\`###\`、数字编号、章节名等），标题句**必须独立成段**，并与后面的正文分开。
- **避免单句段落**：只有在该句本身很长（> 60 字）或语义完整独立时才允许单句成段。

### 输出约定
- breakAfter 值为句子 index，表示在该 index 句子之后插入分段
- 最后一句之后不需要 breakAfter（自动结束）

句子序列（[index] 句子内容）：
${sentences.map((s, i) => `[${i}] ${s.length > 80 ? s.slice(0, 80) + '...' : s}`).join('\n')}

## 提供的文本前部
${inputText}

请严格按以下 JSON 格式输出（不要包含其他内容）：
{
  "analysis": {
    "title": "...",
    "summary": "...",
    "background": "...",
    "tone": "...",
    "keyPoints": ["...", "..."]
  },
  "breakAfter": [3, 7, 14]
}`

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
      temperature: 0.5,
      max_tokens: 4096,
    },
  })

  const content = response.choices[0]?.message?.content || ''
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw createError({ statusCode: 500, message: 'Failed to parse AI response' })
  }

  const result = safeJsonParse(jsonMatch[0])

  // 从句子 + 断点重建段落
  const segs = buildSegmentsFromBreaks(sentences, result.breakAfter || [])

  return { analysis: result.analysis, segments: segs }
})

// ---- 句子分割（处理省略号、缩写等） ----
function splitSentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim()

  // 保护省略号：用占位符替换，避免被当成多个句号
  const protected1 = cleaned.replace(/\.{3,}/g, '…ELLIPSIS…')

  // 保护常见缩写
  const protected2 = protected1
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|viz|e\.g|i\.e)\./gi, '$1〈DOT〉')
    .replace(/\b([A-Z])\./g, '$1〈DOT〉')  // 首字母缩写如 "U.S."

  // 在句末标点处分割
  const parts = protected2.split(/(?<=[.!?。！？"」])\s*/)

  // 恢复占位符
  const restored = parts
    .map((s) => s.replace(/…ELLIPSIS…/g, '...').replace(/〈DOT〉/g, '.'))
    .filter((s) => s.trim().length > 0)

  return restored
}

// ---- 从断点构建段落 ----
function buildSegmentsFromBreaks(sentences: string[], breakAfter: number[]): Array<{ id: string; index: number; text: string }> {
  const breaks = new Set(breakAfter)
  const raw: Array<{ id: string; index: number; text: string }> = []
  let start = 0

  for (let i = 0; i < sentences.length; i++) {
    if (breaks.has(i) || i === sentences.length - 1) {
      const segText = sentences.slice(start, i + 1).join(' ').replace(/\s+([。！？，、；：])/g, '$1').replace(/\s{2,}/g, ' ').trim()
      if (segText) {
        raw.push({ id: '', index: 0, text: segText })
      }
      start = i + 1
    }
  }

  // 合并过短的段落（单句且非长句）到前后
  if (raw.length > 1) {
    const merged: typeof raw = []
    for (let i = 0; i < raw.length; i++) {
      const s = raw[i]
      const isShort = s.text.length < 40 && !/[。！？]/.test(s.text)
      if (isShort && merged.length > 0) {
        // 短句合并到前一段
        merged[merged.length - 1].text += ' ' + s.text
      } else if (isShort && i + 1 < raw.length) {
        // 短句合并到后一段
        raw[i + 1].text = s.text + ' ' + raw[i + 1].text
      } else {
        merged.push({ ...s })
      }
    }
    return merged.map((s, idx) => ({ id: `p-${idx}`, index: idx, text: s.text }))
  }

  if (raw.length <= 1) {
    return fallbackSegment(sentences.join(' '))
  }

  return raw.map((s, idx) => ({ id: `p-${idx}`, index: idx, text: s.text }))
}

// ---- 兜底分段（AI 返回不可用时） ----
function fallbackSegment(text: string): Array<{ id: string; index: number; text: string }> {
  // 先按自然空行分段
  const blocks = text.split(/\n\s*\n/).filter((b) => b.trim())
  if (blocks.length > 1) {
    return blocks.map((t, i) => ({ id: `q-${i}`, index: i, text: t.trim() }))
  }

  // 无空行时按句子分组：2~3 句一段，尽量均衡
  const raw = text.replace(/\s+/g, ' ').trim()
  // 先保护省略号
  const prepped = raw.replace(/\.{3,}/g, '…')
  const sentences = prepped.split(/(?<=[.!?。！？"」])\s*/)
    .map((s) => s.replace(/…/g, '...'))
    .filter((s) => s.trim().length > 0)

  if (sentences.length <= 2) {
    return [{ id: 'q-0', index: 0, text: raw }]
  }

  const groups: string[] = []
  // 目标每组约 2.5 句，动态调整
  const targetSize = Math.max(2, Math.round(sentences.length / Math.round(sentences.length / 2.5)))

  for (let i = 0; i < sentences.length; i += targetSize) {
    const group = sentences.slice(i, i + targetSize)
    // 最后一组如果只有 1 句，合并到前一组
    if (group.length === 1 && groups.length > 0) {
      groups[groups.length - 1] += ' ' + group[0]
    } else {
      groups.push(group.join(' '))
    }
  }

  return groups.map((t, i) => ({ id: `q-${i}`, index: i, text: t.trim() }))
}

// ---- JSON 容错解析 ----
function safeJsonParse(raw: string): any {
  // 尝试直接解析
  try { return JSON.parse(raw) } catch {}

  // 补全未闭合的字符串
  let fixed = raw
  if ((fixed.match(/"/g) || []).length % 2 !== 0) {
    fixed += '"'
  }

  // 补全未闭合的数组
  let depth = 0
  for (const ch of fixed) {
    if (ch === '[') depth++
    if (ch === ']') depth--
  }
  for (let i = 0; i < depth; i++) fixed += ']'

  // 补全未闭合的对象
  let objDepth = 0
  let inString = false
  for (let i = 0; i < fixed.length; i++) {
    if (fixed[i] === '"' && fixed[i - 1] !== '\\') inString = !inString
    if (!inString) {
      if (fixed[i] === '{') objDepth++
      if (fixed[i] === '}') objDepth--
    }
  }
  for (let i = 0; i < objDepth; i++) fixed += '}'

  try { return JSON.parse(fixed) } catch {}

  // 最后兜底
  throw createError({ statusCode: 500, message: 'AI returned malformed JSON' })
}
