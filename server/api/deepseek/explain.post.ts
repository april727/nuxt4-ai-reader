import type { ParagraphActionRequest } from '#shared/types'
import { deepseekChat } from '../../utils/deepseek'

export default defineEventHandler(async (event) => {
  const body = await readBody<ParagraphActionRequest>(event)

  const systemPrompt = `你是一个严格遵守格式的输出助手。输出 Markdown 表格时，每一行必须包含完全相同数量的竖线 |。在开始填写内容前，默默数一遍表头有几列，之后每行都保持相同列数，不得多也不得少。`

  const prompt = `对以下段落进行深度解读。结合文章整体语境分析。

## 文章背景
${body.articleContext}

## 待分析段落
${body.paragraph}

直接从「### 一、整体翻译」开始输出，不要任何开场白。

### 一、整体翻译

将整段话翻译成流畅的中文（忠实原文，不添加不删减）。

---

### 二、难点词汇解析

从段落中提取 5～6 个最重要的关键词汇（不超过6个）。

按以下步骤执行，不得跳过：

第一步，输出表头和分隔行，固定为以下两行：
|词汇 | 释义 | 语境理解 |
|------------|----------|----------|

第二步，逐行填写词汇数据。每写一行之前，先默数：这行是否有4个竖线？是否有3列？确认后再输出。

每一行的固定模板为：
| 第1列:英文词汇 | 第2列:中文释义 | 第3列:语境说明 |

列内容规则：
- 第1列：英文单词或短语，不含中文
- 第2列：简短中文释义，多义用分号隔开，全部写在同一格内
- 第3列：该词在本段落中的具体语境说明，纯中文

单元格内若需换行，只能用 `<br>`，不得直接回车。

正确示例（输出结构必须与此完全一致，包括每行竖线数量）：

|词汇 | 释义 | 语境理解 |
|------------|----------|----------|
| pressurized | 加压的 | 指宇航服手套内部维持气压，保证宇航员在真空中生存，但增加了手部活动阻力 |
| weightlessness | 失重 | 太空中物体不受重力影响的状态，导致工具漂浮、操作困难 |

---

### 三、段落精讲

结合文章背景，用 2～4 句话总结这段话的核心意思及其在全文中的作用。`

  const content = await deepseekChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.5, maxTokens: 8000 },
  )

  return { content }
})
