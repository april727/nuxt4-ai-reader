/**
 * 段落解释的 JSON 解析 + 固定模板渲染（前端 & 服务端后台任务共用）
 * 模型只输出内容 JSON，格式由这里 100% 控制。
 */

export interface ExplainJson {
  translation: string
  /** 逐句翻译：按原文句子顺序的中文译文数组（用于选中原文→高亮对应翻译） */
  sentenceTranslations?: string[]
  vocab: Array<{ word: string; meaning: string; context: string }>
  summary: string
}

/** 解析 explain 的 JSON 输出（容错：剥离代码块、提取平衡 JSON、修复尾随逗号） */
export function parseExplainJson(raw: string): ExplainJson | null {
  let text = (raw || '').trim()
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) text = codeBlock[1].trim()

  const start = text.indexOf('{')
  if (start === -1) return null

  // 提取第一个平衡的 { ... }（跳过字符串里的 { }）
  let depth = 0
  let inString = false
  let escaped = false
  let end = -1
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  if (end === -1) return null

  const jsonStr = text.slice(start, end + 1)
  try {
    return JSON.parse(jsonStr)
  } catch {
    try {
      return JSON.parse(jsonStr.replace(/,(\s*[}\]])/g, '$1'))
    } catch {
      return null
    }
  }
}

/** 用固定模板把 explain JSON 渲染成完整 Markdown（含整段翻译；无逐句时用） */
export function renderExplainMarkdown(json: ExplainJson): string {
  const body = renderExplainBody(json)
  return ['### 一、整体翻译', (json.translation || '').trim(), '', body].join('\n')
}

/**
 * 解析旧版 Markdown 格式的段落解释（兼容历史缓存）。
 * 旧版结构：### 一、整体翻译 / ### 二、难点词汇解析(表格) / ### 三、段落精讲
 * 返回 ExplainJson（无 sentenceTranslations，高亮降级为序号映射）。
 */
export function parseExplainMarkdown(md: string): ExplainJson | null {
  const text = md || ''
  const transMatch = text.match(/###\s*一、整体翻译\s*\n([\s\S]*?)(?=\n###\s*二、|$)/)
  const vocabMatch = text.match(/###\s*二、难点词汇解析\s*\n([\s\S]*?)(?=\n###\s*三、|$)/)
  const sumMatch = text.match(/###\s*三、段落精讲\s*\n([\s\S]*)$/)

  const translation = (transMatch?.[1] || '').trim()
  const summary = (sumMatch?.[1] || '').trim()

  // 解析词汇表格：| 词汇 | 释义 | 语境 |
  const vocab: Array<{ word: string; meaning: string; context: string }> = []
  const tableText = vocabMatch?.[1] || ''
  for (const line of tableText.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    if (/^\|[\s\-]+\|/.test(trimmed)) continue // 跳过分隔行
    const cells = trimmed.split('|').map((c) => c.trim()).filter((c) => c !== '')
    // 跳过分隔行和表头行（| 词汇 | 释义 | 语境理解 |），避免表头被当作词汇条目
    if (cells.length && (cells[0] === '词汇' || cells[0] === '单词')) continue
    if (cells.length >= 3) {
      vocab.push({ word: cells[0], meaning: cells[1], context: cells.slice(2).join(' ') })
    }
  }

  if (!translation && !vocab.length && !summary) return null
  return { translation, vocab, summary }
}

/**
 * 渲染「难点词汇解析 + 段落精讲」的 Markdown（翻译部分由前端按句渲染以支持高亮）
 */
export function renderExplainBody(json: ExplainJson): string {
  const rows = (json.vocab || [])
    .map((v) => `| ${(v.word || '').trim()} | ${(v.meaning || '').trim()} | ${(v.context || '').trim()} |`)
    .join('\n')
  return [
    '### 二、难点词汇解析',
    '| 词汇 | 释义 | 语境理解 |',
    '|------|------|----------|',
    rows,
    '',
    '### 三、段落精讲',
    (json.summary || '').trim(),
  ].join('\n')
}

/**
 * 改写 Markdown 中所有指向同一 src 的图片宽度标记（如 '60%' 或 '300'）。
 * 语法与 MarkdownRenderer 的尺寸正则一致：`![alt](src =60%)`。
 * width='auto' 时移除尺寸标记（恢复原始渲染宽度）。
 * 找不到该 src 时原样返回。供「显示模式点击图片调整大小」用。
 */
export function setMarkdownImageWidth(md: string, src: string, width: string): string {
  if (!md || !src) return md
  const esc = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(!\\[[^\\]]*\\]\\()${esc}(?:\\s*=\\s*\\d+(?:\\.\\d+)?%?)?(\\))`, 'g')
  if (width === 'auto') return md.replace(re, `$1${src}$2`)
  return md.replace(re, `$1${src} =${width}$2`)
}
