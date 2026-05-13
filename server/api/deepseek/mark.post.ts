import type { MarkExplainRequest } from '#shared/types'

export default defineEventHandler(async (event) => {
  const body = await readBody<MarkExplainRequest>(event)

  const apiKey = process.env.DEEPSEEK_API_KEY
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'

  if (!apiKey) throw createError({ statusCode: 500, statusMessage: 'DEEPSEEK_API_KEY not configured' })

  const typeLabel = body.type === 'word' ? '单词/词汇' : body.type === 'phrase' ? '短语/搭配' : '句子'

  const prompt = `深度解释以下${typeLabel}，结合段落语境和文章背景。请输出包含 detail 和 phonetic 两个字段的 JSON。

## 文章背景
${body.articleContext}

## 所在段落
${body.paragraphContext}

## 待解释的${typeLabel}
${body.text}

## 要求
${body.type === 'word' ? `
### 基本释义
列出该词的核心含义（1~2个）。

### 其他常用用法
列出该词在不同语境下的常见用法（简短说明+例句）。

### 当前语境用法
分析该词在当前段落中的具体含义和语用功能。
` : body.type === 'phrase' ? `
### 短语含义
解释该短语/搭配的意思。

### 用法说明
说明该短语的语法结构、语域和使用场景。

### 语境分析
分析该短语在当前段落中的作用和表达效果。

### 可替换表达
提供 1~2 个近义表达。
` : `
### 句子解析
分析句子语法结构和逻辑关系。

### 含义阐述
用中文解释句子含义。

### 修辞/表达分析
分析句子中的修辞手法或表达技巧。

### 在段落中的作用
说明该句在段落中的功能（论点、论据、过渡等）。
`}

禁止开场白和自我介绍。detail 字段内容为 Markdown 格式（从 ### 标题开始）。${
  body.type === 'word' ? 'phonetic 字段填写英式音标，如 /ˈfəʊnətɪk/。' : 'phonetic 字段填空字符串。'}

输出格式（严格 JSON，不要额外文字）：
{
  "detail": "### 基本释义\\n...\\n### 其他常用用法\\n...",
  "phonetic": "/ɪɡˈzæmpəl/"
}`

  const response = await $fetch<{ choices: Array<{ message: { content: string } }> }>(
    `${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: { model, messages: [{ role: 'user', content: prompt }], temperature: 0.5, max_tokens: 2500 }
    })

  const content = response.choices[0]?.message?.content || ''
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    // 兜底：返回纯文本
    return { detail: content, phonetic: '' }
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return { detail: parsed.detail || content, phonetic: parsed.phonetic || '' }
  } catch {
    return { detail: content, phonetic: '' }
  }
})
