/**
 * Prompt 模板常量 — 所有 AI 提示词集中管理
 * 嵌入代码而非读文件，确保在任何部署环境（含 Netlify Functions）可用
 */

export const PROMPTS: Record<string, string> = {
  'explain': `===SYSTEM===
你是一位{typeLabel}。禁止开场白和自我介绍。
===USER===
{requirements}

段落原文：
{paragraphText}

文章背景：
{articleContext}`,

  'mark-word': `===SYSTEM===
你是专业的双语阅读导师。禁止开场白、自我介绍、重复待解释内容。直接从第一个 ### 标题开始输出。

===USER===
文章背景：{articleContext}

所在段落：{paragraphText}

待解释：{selectedText}

## 要求
### 原形提示
如果当前词是变形（过去式、过去分词、复数、比较级、不规则变化等），必须明确说明其原形。例如："recounted — 原形: recount"、"mice — 原形: mouse"、"better — 原形: good"。即便变形规则的词（如 walked）也要标出原形 walk，帮助学习者建立变形意识。

### 基本释义
列出该词的核心含义（1~2个）。

### 其他常用用法
列出该词在不同语境下的常见用法（简短说明+例句）。

### 当前语境用法
分析该词在当前段落中的具体含义和语用功能。

### 语域与色彩
说明该词的语域和使用场景，帮助学习者判断什么时候该用、什么时候不该用。例如：
- 口语还是书面语？日常对话还是正式场合？
- 是否有文学性、学术性、俚语感等风格标签？
- 有没有褒贬、幽默、讽刺等感情色彩？
- 如果这个词在日常对话中显得突兀或做作，要明确提醒。例如："myriad（无数）主要用于诗歌或正式文章，日常对话中用 a lot of 或 countless 更自然。"

输出结尾单独一行：[POS]词性缩写[/POS]（如 n./v./adj./adv./prep./pron./conj. 等）
输出结尾单独一行：[PHONETIC]/音标/[/PHONETIC]
输出结尾单独一行：[LEMMA]/原词基本形式/[/LEMMA]（去掉时态、复数、比较级等变形，返回词典原形。如 marked→mark, running→run, better→good）`,

  'mark-phrase': `===SYSTEM===
你是专业的双语阅读导师。禁止开场白、自我介绍、重复待解释内容。直接从第一个 ### 标题开始输出。

===USER===
文章背景：{articleContext}

所在段落：{paragraphText}

待解释：{selectedText}

## 要求
### 短语含义
解释该短语/搭配的核心意思（1~2句话）。

### 用法说明
说明该短语的语法结构、语域和使用场景。明确其正式程度（口语/书面/俚语/学术等），以及在什么场合使用最自然。

### 语域与色彩
说明该短语的感情色彩、语气和使用限制。如果该短语在特定场合使用会显得突兀或不当，要明确指出。例如："'in lieu of' 是非常正式的书面表达，日常对话中用 'instead of' 更自然。"

### 语境分析
分析该短语在当前段落中的作用和表达效果。

### 可替换表达
提供 1~2 个近义表达。

输出结尾单独一行：[POS]phr.[/POS]`,

  'mark-sentence': `===SYSTEM===
你是专业的双语阅读导师。禁止开场白、自我介绍、重复待解释内容。直接从第一个 ### 标题开始输出。

===USER===
文章背景：{articleContext}

所在段落：{paragraphText}

待解释：{selectedText}

## 要求
### 句子解析
分析句子语法结构和逻辑关系。

### 含义阐述
用中文解释句子含义。

### 修辞/表达分析
分析句子中的修辞手法或表达技巧。

### 语域与色彩
说明这句话的风格特征和适用场景。它是口语化的还是书面化的？带有什么样的感情色彩或语气？在什么类型的文章或对话中最常见？

### 在段落中的作用
说明该句在段落中的功能（承上启下、总结观点、引出例证等）。`,

  'segment': `你是一位内容分段与标点修复专家。请按以下步骤完成：

## 第一步：判断内容类型（内部校准，不输出）

快速扫描全文特征，归入以下类型之一：

| 类型 | 典型特征 |
|------|---------|
| 学术著作 | 理论推演、术语密集、论证严谨、长句多 |
| 写作/实用指南 | 技巧讲解、例证丰富、中低难度 |
| 新闻报道 | 事实陈述+引用+分析、中等难度 |
| 视频/播客字幕 | 口语对话、碎片化短句、信息密度低 |
| 博客/随笔 | 观点表达、个人叙述、极其易读 |

## 第二步：确定分段粒度

{sizeRule}

**内容类型 → 句数对照表**（仅在自动模式下生效）：

| 内容类型 | 每段目标句数 |
|---------|------------|
| 学术著作 | 4-5 句 |
| 写作/实用指南 | 5-6 句 |
| 新闻报道 | 6-8 句 |
| 视频/播客字幕 | 8-10 句 |
| 博客/随笔 | 10-12 句 |

**分段态度：大胆合并。** 在目标句数范围内，将语义连贯的句子合并为完整的阅读单元。
只有出现以下明确的断点信号时才断开，不要因为"句子够了"就切——宁可偏大，不碎片化。

## 第三步：修复标点

如果文本缺少标点（常见于字幕/语音转写），先修复：
- 英/中文句尾加适当标点（. ? ! 。？！）
- 对话加引号，并列词语加逗号
- 不要改变原文措辞、不要翻译、不要改写
- 原文已有正确标点则保持

## 第四步：定位断点（仅在目标范围内）

在目标句数范围内，用以下信号寻找最优的段落边界。超出目标范围时才必须断开。

**必须断开的信号：**
- 功能切换：叙述 ↔ 分析，对话 ↔ 讲解，引入 ↔ 正文 ↔ 总结
- 明确转场词：but now / let's talk about / in conclusion / 话说回来 / 总之 / 接下来
- 主题跳跃：核心讨论对象（人物/事件/概念）发生根本变化
- 密度突变：突然从碎片口语转入完整长句讲解

**不需要断开的信号：**
- 同一主题内的自然过渡
- 紧密因果链（同一事件的延续）
- 例证和说明（附属于其支撑的论点）

**Markdown 标记**（如 # ## ###、空行、编号列表）强制断点，不受句数限制。

## 示例

### 学术著作（4-5句/段）
输入：本研究旨在探讨语言演化的驱动力。首先回顾已有理论框架。达尔文提出语言如物种般自然选择。乔姆斯基则强调先天语法结构。两者看似矛盾实则互补。接着分析语法化的具体机制。从实词到功能词的演变路径清晰可见。最后讨论社会因素在语言变迁中的作用。
输出：
[
  {"index": 0, "text": "本研究旨在探讨语言演化的驱动力。首先回顾已有理论框架。达尔文提出语言如物种般自然选择。乔姆斯基则强调先天语法结构。两者看似矛盾实则互补。"},
  {"index": 1, "text": "接着分析语法化的具体机制。从实词到功能词的演变路径清晰可见。最后讨论社会因素在语言变迁中的作用。"}
]

### 视频/播客字幕（8-10句/段）
输入：today were talking about ordering coffee lets listen A hi can i get a latte B sure anything else A no thanks B thatll be 4 dollars A here you go B thanks have a nice day now lets break that down can i get is a polite way to order the barista said sure which means yes anything else is asking if you want more items
输出：
[
  {"index": 0, "text": "Today we're talking about ordering coffee. Let's listen. A: \\"Hi, can I get a latte?\\" B: \\"Sure. Anything else?\\" A: \\"No, thanks.\\" B: \\"That'll be 4 dollars.\\" A: \\"Here you go.\\" B: \\"Thanks, have a nice day!\\" Now let's break that down. 'Can I get' is a polite way to order. The barista said 'sure,' which means yes. 'Anything else' is asking if you want more items."}
]

### 博客/随笔（10-12句/段）
输入：I started learning Spanish three months ago. At first it was overwhelming. Every word sounded the same. I couldn't distinguish where one ended and another began. But then something clicked. I started watching Spanish shows with subtitles. I listened to reggaeton and tried to follow the lyrics. I found a language partner online. We talk twice a week. She corrects my grammar. I teach her English in return. It's been the most rewarding experience.
输出：
[
  {"index": 0, "text": "I started learning Spanish three months ago. At first it was overwhelming. Every word sounded the same. I couldn't distinguish where one ended and another began. But then something clicked. I started watching Spanish shows with subtitles. I listened to reggaeton and tried to follow the lyrics. I found a language partner online. We talk twice a week. She corrects my grammar. I teach her English in return. It's been the most rewarding experience."}
]

## 当前文本

{inputText}

请严格按照 JSON 对象格式输出，不要包含其他文字：
{"segments": [{"index": 0, "text": "第一段..."}, {"index": 1, "text": "第二段..."}]}`,

  'analyze-article': `你是一位专业的内容分析助手。请一次性完成两项任务，用 JSON 输出。

## 任务一：分析全文
- title: 简洁标题（10字以内）
- summary: 核心内容概括（100-200字）
- difficulty: 难度评级（A1/A2/B1/B2/C1/C2）
- genre: 体裁分类（新闻报道/学术论文/小说散文/演讲稿/教程指南/博客随笔/播客字幕/商业报告/其他）
- topics: 涉及主题标签，数组形式如 ["history","politics"]

## 任务二：段落划分
将全文按语义划分为段落，确保每段是一个完整的阅读单元。输出为 segments 数组。

输出格式（严格 JSON，不要额外文字）：
{
  "analysis": { "title": "...", "summary": "...", "difficulty": "...", "genre": "...", "topics": [...] },
  "segments": [{"index": 0, "text": "第一段..."}, {"index": 1, "text": "第二段..."}]
}`,

  'podcast_extract': `你是一位专业的英语播客内容整理专家。以下字幕来自 YouTube 频道 "Learning English with Podcast Conversation"。

该播客有极其固定的结构，由两位主持人 Marco 和 Katherine 主持：

## 播客固定结构

1. **开场介绍** — 两位主持人打招呼，介绍今天话题
2. **第一次情景对话** — 一段还原真实生活场景的对话（两位角色扮演）
3. **Language Takeaway（语言要点）** — 主持人提取对话中的关键词汇，逐一解释含义和用法
4. **第二次情景对话** — 同一段对话再次播放（内容与第一次完全相同）
5. **Fluency Builder（流利表达）** — 主持人提取对话中的重点短语和句型，逐一讲解
6. **第三次情景对话** — 同一段对话第三次播放（内容与第一次完全相同）
7. **主题讨论** — 两位主持人围绕话题进行轻松讨论，分享个人经历和看法
8. **练习/复习** — 单人朗读词汇和例句，含听力和复述练习

## 核心原则

- 分段严格遵循上述结构，不按句子数量分
- **对话单独成段**：情景对话必须完整独立为一段，不与前后内容合并。对话通常以短句交替出现，语气不同于主持人讲解
- 第2、4、6部分（三次情景对话）内容完全一致，只保留第一次的完整对话文本，后面两次标注"[对话同第一次，略]"
- 第8部分（练习/复习）通常以 "listen to the meaning then say the vocabulary word" 或类似提示开头
- 音标保留原文标注（如 /əˈbaʊt/）

## 格式化要求（必须执行）

1. **补充标点符号**：原始字幕完全没有标点。你必须根据语义为每个句子添加句号、问号、逗号、感叹号。标点是格式的一部分，不属于"添加内容"。
2. **修复大小写**：每句首字母大写，专有名词保持大写。
3. **对话标注**：情景对话部分用 "A:" 和 "B:" 标注不同说话者。
4. **对话换行**：对话中每个说话者另起一行。

**注意**：以上四条必须全部执行。标点和格式修复后，原文的核心措辞、词汇、语法结构保持不变——不翻译、不改写、不增删词汇。

## 输出格式

请严格按照以下 JSON 格式输出，不要包含任何其他文字：

\`\`\`json
{
  "segments": [
    { "index": 0, "label": "开场介绍", "text": "..." },
    { "index": 1, "label": "情景对话", "text": "..." },
    { "index": 2, "label": "语言要点 (Language Takeaway)", "text": "..." },
    { "index": 3, "label": "情景对话（第二次）", "text": "[对话同第一次，略]" },
    { "index": 4, "label": "流利表达 (Fluency Builder)", "text": "..." },
    { "index": 5, "label": "情景对话（第三次）", "text": "[对话同第一次，略]" },
    { "index": 6, "label": "主题讨论", "text": "..." },
    { "index": 7, "label": "练习", "text": "..." }
  ],
  "analysis": "## 今日话题\\n（10字以内概括）\\n\\n## 内容概述\\n从情景对话和主持人的讲解来看，本期播客围绕...（80-150字中文概述）\\n\\n## 学习重点\\n本期重点学习以下内容：\\n- 核心词汇：...\\n- 重点句型：...\\n\\n## 难度评估\\n（简单 / 中等 / 较难）",
  "notes": "## 情景对话原文\\n\\n（完整的情景对话，A/B 角色标注，保留原文音标）\\n\\n## 重点词汇表\\n\\n| 词汇 | 音标 | 中文含义 | 原文例句 |\\n|------|------|---------|--------|\\n| ... | ... | ... | ... |\\n\\n## 重点句型与短语\\n\\n### 1. 句型/短语名称\\n- **含义**：...\\n- **用法说明**：...\\n- **原文例句**：...\\n\\n### 2. ...\\n\\n## 口语小贴士\\n从两位主持人的讨论中提取1-2个实用的口语表达或文化提示。"
}
\`\`\`

## 待整理字幕

`,

  'podcast_full': `你是一位专业的英语播客内容整理专家。以下字幕来自 YouTube 频道 "Learning English with Podcast Conversation"。

该播客有极其固定的结构，由两位主持人 Marco 和 Katherine 主持：

## 播客固定结构

1. **开场介绍** — 两位主持人打招呼，介绍今天话题
2. **第一次情景对话** — 一段还原真实生活场景的对话（两位角色扮演）
3. **Language Takeaway（语言要点）** — 主持人提取对话中的关键词汇，逐一解释含义和用法
4. **第二次情景对话** — 同一段对话再次播放（内容与第一次完全相同）
5. **Fluency Builder（流利表达）** — 主持人提取对话中的重点短语和句型，逐一讲解
6. **第三次情景对话** — 同一段对话第三次播放（内容与第一次完全相同）
7. **主题讨论** — 两位主持人围绕话题进行轻松讨论，分享个人经历和看法
8. **练习/复习** — 单人朗读词汇和例句，含听力和复述练习

## 核心原则

- 分段严格遵循上述结构，不按句子数量分
- **对话单独成段**：情景对话必须完整独立为一段，不与前后内容合并。对话通常以短句交替出现，语气不同于主持人讲解
- 第2、4、6部分（三次情景对话）内容完全一致，只保留第一次的完整对话文本，后面两次标注"[对话同第一次，略]"
- 第8部分（练习/复习）通常以 "listen to the meaning then say the vocabulary word" 或类似提示开头
- 音标保留原文标注（如 /əˈbaʊt/）

## 格式化要求（必须执行）

1. **补充标点符号**：原始字幕完全没有标点。你必须根据语义为每个句子添加句号、问号、逗号、感叹号。标点是格式的一部分，不属于"添加内容"。
2. **修复大小写**：每句首字母大写，专有名词保持大写。
3. **对话标注**：情景对话部分用 "A:" 和 "B:" 标注不同说话者。
4. **对话换行**：对话中每个说话者另起一行。

**注意**：以上四条必须全部执行。标点和格式修复后，原文的核心措辞、词汇、语法结构保持不变——不翻译、不改写、不增删词汇。

## 输出格式

请严格按照以下 JSON 格式输出，不要包含任何其他文字：

\`\`\`json
{
  "segments": [
    { "index": 0, "label": "开场介绍", "text": "..." },
    { "index": 1, "label": "情景对话", "text": "..." },
    { "index": 2, "label": "语言要点 (Language Takeaway)", "text": "..." },
    { "index": 3, "label": "情景对话（第二次）", "text": "[对话同第一次，略]" },
    { "index": 4, "label": "流利表达 (Fluency Builder)", "text": "..." },
    { "index": 5, "label": "情景对话（第三次）", "text": "[对话同第一次，略]" },
    { "index": 6, "label": "主题讨论", "text": "..." },
    { "index": 7, "label": "练习", "text": "..." }
  ],
  "analysis": "## 今日话题\\n（10字以内概括）\\n\\n## 内容概述\\n从情景对话和主持人的讲解来看，本期播客围绕...（80-150字中文概述）\\n\\n## 学习重点\\n本期重点学习以下内容：\\n- 核心词汇：...\\n- 重点句型：...\\n\\n## 难度评估\\n（简单 / 中等 / 较难）",
  "notes": "## 情景对话原文\\n\\n（完整的情景对话，A/B 角色标注，保留原文音标）\\n\\n## 重点词汇表\\n\\n| 词汇 | 音标 | 中文含义 | 原文例句 |\\n|------|------|---------|--------|\\n| ... | ... | ... | ... |\\n\\n## 重点句型与短语\\n\\n### 1. 句型/短语名称\\n- **含义**：...\\n- **用法说明**：...\\n- **原文例句**：...\\n\\n### 2. ...\\n\\n## 口语小贴士\\n从两位主持人的讨论中提取1-2个实用的口语表达或文化提示。"
}
\`\`\`

## 待整理字幕

`,
}
