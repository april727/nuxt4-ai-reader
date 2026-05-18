export default defineEventHandler(async (event) => {
  const body = await readBody<{ text: string }>(event)
  if (!body?.text?.trim()) throw createError({ statusCode: 400, message: '文本为空' })

  const apiKey = process.env.DEEPSEEK_API_KEY
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'

  if (!apiKey) {
    throw createError({ statusCode: 500, message: 'DEEPSEEK_API_KEY not configured' })
  }

  const prompt = `你的任务是清理和格式化任意类型的文本段落。不要翻译、总结或添加新内容。

## 自检步骤（内部，不输出）

先判断文本类型：
- 如果是字幕转录：补充缺失的标点（句号、逗号等），修正大小写
- 如果是文章摘录：修正换行问题、合并被意外打断的句子、识别并标注非正文元素
- 如果是 OCR 或机器提取文本：修复合并词、多余空格、乱码字符

## 常见处理

- 补充英文句末标点（. ? !）
- 句子首字母大写，专有名词保留大写
- 合并同一句子内被换行符打断的片段
- 移除重复的无意义内容
- 如果文本中包含明显的标题行（全大写、独立短句），用 # 标记
- 如果文本中包含图片说明/脚注/旁注，作为独立段落保留

## 输出

只输出清理后的文本。每句一行或自然成段。不加说明、不加 Markdown（除非识别到标题用 #）。`

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
      messages: [{ role: 'user', content: `${prompt}\n\n待整理文本：\n${body.text}` }],
      temperature: 0.1,
      max_tokens: 4096,
    },
  })

  const content = response.choices[0]?.message?.content || ''
  return { cleaned: content.trim() }
})
