import type { ParagraphActionRequest } from '#shared/types'

export default defineEventHandler(async (event) => {
  const body = await readBody<ParagraphActionRequest>(event)

  const apiKey = process.env.DEEPSEEK_API_KEY
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'

  if (!apiKey) {
    throw createError({ statusCode: 500, statusMessage: 'DEEPSEEK_API_KEY not configured' })
  }

  const prompt = `对以下段落进行深度解读。结合文章整体语境分析。

## 文章背景
${body.articleContext}

## 待分析段落
${body.paragraph}

## 要求
直接从"### 一、整体翻译"开始输出，不要有任何开场白、问候语或自我介绍。严格按照以下三个部分的顺序：

### 一、整体翻译
将整段话翻译成流畅的中文（忠实原文，不添加不删减）。

### 二、难点词汇解析
选出本段落中 **有难度的单词、短语、俚语、习语**（3~8 个），以表格形式列出：

| 词汇/短语 | 音标 | 在文中的含义 | 补充说明 |
|----------|------|-------------|---------|

（挑选真正有难度的内容，基础词汇不列）

### 三、段落精讲
结合文章背景，用 2~4 句话总结这段话的核心意思及其在全文中的作用。

禁止添加任何形式的开场白。输出必须以"### 一、整体翻译"开头。`

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
      max_tokens: 3000,
    },
  })

  return { content: response.choices[0]?.message?.content || '' }
})
