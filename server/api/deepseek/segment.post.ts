import type { Paragraph } from '#shared/types'

type SegmentType = 'document' | 'subtitle'

/** 句子结尾正则（中英文） */
const SENTENCE_END = /(?<=[.!?。！？"」])\s*/

/** 将文本按句子拆分 */
function splitSentences(text: string): string[] {
  return text.split(SENTENCE_END).map(s => s.trim()).filter(s => s.length > 0)
}

/** 本地兜底分段 */
function splitIntoParagraphs(text: string, type: SegmentType = 'document'): Paragraph[] {
  const GROUP = type === 'subtitle' ? 6 : 4
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
  const sentences = text.replace(/\s+/g, ' ').trim()
    .split(/(?<=[.!?。！？"」])\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 5)

  if (sentences.length <= 1) return text

  // 检查窗口 8 句范围
  const cleaned: string[] = []
  for (let i = 0; i < sentences.length; i++) {
    const cur = sentences[i]
    let isFragment = false
    const windowEnd = Math.min(i + 1 + 8, sentences.length)
    for (let j = i + 1; j < windowEnd; j++) {
      const future = sentences[j]
      // cur 完整包含在 future 中且 future 更长 → cur 是碎片
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

// ============================================================
//  通用分段 Prompt（不预设内容类型）
// ============================================================
//
//  不做"这是播客"或"这是文章"的预判——而是教 AI 一套通用的结构发现方法论。
//  无论面对对话、演讲、教程、论文还是新闻，AI 都用同样的信号体系来定位边界。
//
function buildUniversalPrompt(inputText: string): string {
  return `你是一位内容分段专家。请将以下文本拆分为有意义的阅读段落。

## 第一步：自检文本特征（内部判断，不输出）

快速扫描文本开头 2~3 句，判断内容类型：
- 长句密集、有章节标题 → 书籍/文章
- 短句碎片化、有说话人标记 → 对话/采访
- 对话和讲解交替出现 → 教程/播客
- 有明确论点+论据+结论 → 议论文/演讲

这个判断用于指导后续分段——不输出，仅内部校准。

## 第二步：信号体系定位边界

基于自检结果，结合以下信号定位段落边界：

**信号1 — 功能切换**
文本中不同功能区域交替时断开：
- 叙述 ↔ 分析/论证
- 对话 ↔ 讲解/旁白
- 引入 ↔ 正文 ↔ 总结
- 提问 ↔ 回答

**信号2 — 语言标记**
注意明确的结构转场词（所有语言）：
- 序列：first/second/finally、接下来/首先/最后
- 转折：but now/let's talk about/on the other hand、话说回来/另一方面
- 总结：in conclusion/to sum up、总之/综上所述
- 引导：let's look at/now for/here's、让我们看看/这里是

**信号3 — 主题跳跃**
- 当核心讨论对象（人物、事件、概念）发生明显变化时断开
- 但紧密相关的延续（同一事件的因果链）不要断开

**信号4 — 密度突变**
- 突然变长的句子（碎片口语 → 完整长句）往往意味着从随意聊天转入正式讲解
- 术语密集度突变也暗示内容类型切换

**信号5 — 重复与回环**
- 同一内容的再次出现（如播客中"再听一遍对话"）应独立成段
- 结构性重复（反复出现的模式）应识别为段落边界

## 核心原则

- 每段包含一个完整的内容功能单元
- 不用固定句数——由上述信号决定边界
- 宁可段落稍长，不割裂完整表达
- 尊重原有 Markdown 标记（# ## ###、空行、编号）如果存在

## 示例

### 学术文章
输入：本研究探讨三个问题。首先回顾相关文献。学者A提出X理论。学者B则主张Y理论。两者存在根本分歧。接着设计实验方案。实验采用双盲对照。最后分析数据得出结论。
输出：
[
  {"index": 0, "text": "本研究探讨三个问题。"},
  {"index": 1, "text": "首先回顾相关文献。学者A提出X理论。学者B则主张Y理论。两者存在根本分歧。"},
  {"index": 2, "text": "接着设计实验方案。实验采用双盲对照。"},
  {"index": 3, "text": "最后分析数据得出结论。"}
]

### 教育播客/课程
输入：Welcome to English Podcast. Today we're talking about ordering coffee. Let's listen to a dialogue. A: I'd like a latte please. B: Sure. Now let's look at the vocabulary. A latte is coffee with steamed milk. Let's listen again. A: I'd like a latte please. Now for the grammar. Would like is more polite than want. Before we go, a cultural note. In the US, tipping is expected. That's all for today.
输出：
[
  {"index": 0, "text": "Welcome to English Podcast. Today we're talking about ordering coffee."},
  {"index": 1, "text": "Let's listen to a dialogue. A: I'd like a latte please. B: Sure."},
  {"index": 2, "text": "Now let's look at the vocabulary. A latte is coffee with steamed milk."},
  {"index": 3, "text": "Let's listen again. A: I'd like a latte please."},
  {"index": 4, "text": "Now for the grammar. Would like is more polite than want."},
  {"index": 5, "text": "Before we go, a cultural note. In the US, tipping is expected."},
  {"index": 6, "text": "That's all for today."}
]

### 采访/对话
输入：Reporter: Tell us about your latest project. Scientist: We're developing a new battery. Reporter: What makes it different? Scientist: It charges in five minutes. Reporter: When will it be available? Scientist: Next year, we hope. Now let me explain the technology. The key innovation is a new electrode material.
输出：
[
  {"index": 0, "text": "Reporter: Tell us about your latest project. Scientist: We're developing a new battery. Reporter: What makes it different? Scientist: It charges in five minutes. Reporter: When will it be available? Scientist: Next year, we hope."},
  {"index": 1, "text": "Now let me explain the technology. The key innovation is a new electrode material."}
]

## 当前文本

${inputText}

请严格按照上述 JSON 数组格式输出，不要包含其他文字。`
}

// ============================================================
//  路由处理
// ============================================================

export default defineEventHandler(async (event) => {
  const body = await readBody<{ text: string; type?: SegmentType }>(event)
  const segmentType: SegmentType = body.type || 'document'

  const apiKey = process.env.DEEPSEEK_API_KEY
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'

  if (!apiKey) {
    throw createError({ statusCode: 500, message: 'DEEPSEEK_API_KEY not configured' })
  }

  // 字幕文本去重（纯本地，0 token 消耗）
  const rawText = segmentType === 'subtitle' ? deduplicateText(body.text) : body.text

  // 截断输入
  const maxInputChars = 15000
  const inputText = rawText.length > maxInputChars
    ? rawText.slice(0, maxInputChars) + '\n\n[全文共 ' + rawText.length + ' 字符，此处仅提供前 ' + maxInputChars + ' 字符]'
    : rawText

  const prompt = buildUniversalPrompt(inputText)

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

    // 后处理：仅做尾部碎片合并，不做句子数量限制
    const cleaned = mergeTinyTails(segments)
    return cleaned.length > 0 ? cleaned : [{ id: 'p-0', index: 0, text: body.text }]
  } catch (err: any) {
    console.error(`[segment] AI 分段失败 (type=${segmentType}):`, err.message)
    return splitIntoParagraphs(body.text, segmentType)
  }
})
