/**
 * 表格校验与修正 — 段落解释后处理
 *
 * 验证 AI 输出的词汇解析表格是否符合 3 列格式（10 维度检查）：
 *   结构：列数、表头、分隔行、数据行数
 *   内容：列边界、语言规则、语境完整性
 *   合并：列合并检测（两列挤一列）、第3列丢失、表头混入
 *
 * 不合格则提取表格部分请求 AI 修正（非流式、同步等待，最多 3 次重试）
 */

/**
 * 从 AI 解释输出中提取表格区域
 * 返回 { before, table, after } 三段，方便修正后拼接
 */
export function extractTableSection(text: string): {
  before: string
  table: string
  after: string
} | null {
  // 匹配标题：### 二、难点词汇解析 或 二、难点词汇解析（不带 ###）
  const startRe = /(?:^|\n)(?:###\s+)?二[、，]\s*难点词汇解析\s*/i
  const endRe = /(?:^|\n)(?:###\s+)?三[、，]\s*段落精讲/i

  const startMatch = text.match(startRe)
  if (!startMatch || startMatch.index === undefined) return null

  // 标题在文本中的实际起始位置（跳过行首 \n 或 ###）
  const matchText = startMatch[0]
  const titleIdx = matchText.search(/二[、，]\s*难点词汇解析/i)
  const startIdx = startMatch.index + titleIdx

  const before = text.slice(0, startIdx)

  // 从 startIdx 之后找「三、段落精讲」
  const remainder = text.slice(startIdx)
  const endMatch = remainder.match(endRe)

  let table: string
  let after: string

  if (!endMatch || endMatch.index === undefined) {
    table = text.slice(startIdx)
    after = ''
  } else {
    const endTitleIdx = endMatch.index + (endMatch[0].search(/三[、，]\s*段落精讲/i))
    table = text.slice(startIdx, startIdx + endTitleIdx)
    after = text.slice(startIdx + endTitleIdx)
  }

  return { before, table, after }
}

/**
 * 验证表格是否符合 3 列格式，并检查每列内容是否完整
 *
 * 全维度检查：
 * 1. 结构：每行恰好 4 个 |（3 列）
 * 2. 表头：必须是「|词汇 | 释义 | 语境理解 |」
 * 3. 分隔行：必须是「|------------|----------|----------|」
 * 4. 内容：三列都不能为空
 * 5. 内容规则：第1列不含中文、第2列不含英文、第3列需含语境（非纯释义）
 * 6. 数据行数：≥ 5 且 ≤ 10
 *
 * 返回 errors 数组，每个 error 包含行号和问题描述
 */
export function validateTable(tableText: string): {
  valid: boolean
  errors: Array<{ line: number; text: string; reason: string }>
} {
  const lines = tableText.split('\n')
  const errors: Array<{ line: number; text: string; reason: string }> = []

  // 收集所有表格行
  const tableLineIndices: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('|')) tableLineIndices.push(i)
  }

  if (tableLineIndices.length < 4) {
    // 至少需要：表头 + 分隔行 + 2 行数据（标题行占一行但不是表格行）
    errors.push({ line: 0, text: lines[0] || '', reason: '表格行数不足，至少需要表头、分隔行和 2 行数据' })
    return { valid: false, errors }
  }

  // ── 1. 逐行检查列数和内容 ──
  const dataRows: Array<{ cells: string[]; lineIdx: number }> = []
  let headerLineIdx = -1
  let sepLineIdx = -1

  for (const li of tableLineIndices) {
    const line = lines[li].trim()
    const pipeCount = (line.match(/\|/g) || []).length

    // 1a. 列数检查
    if (pipeCount !== 4) {
      errors.push({ line: li, text: line, reason: `竖线数量错误：${pipeCount} 个（应为 4 个，即 3 列）` })
      continue
    }

    // 1b. 提取三列内容
    const parts = line.split('|')
    const cells = parts.slice(1, 4).map(s => s.trim())

    // 列数不足（容错）
    if (cells.length < 3) {
      errors.push({ line: li, text: line, reason: `无法提取 3 列内容，split 后仅 ${cells.length} 列` })
      continue
    }

    // 1c. 三列都不能为空
    const emptyCols: number[] = []
    for (let c = 0; c < 3; c++) {
      if (!cells[c]) emptyCols.push(c + 1)
    }
    if (emptyCols.length > 0) {
      errors.push({ line: li, text: line, reason: `第 ${emptyCols.join('、')} 列为空` })
      continue
    }

    // 判断行类型
    if (/^[-:]+\s*$/.test(cells[0]) && /^[-:]+\s*$/.test(cells[1])) {
      sepLineIdx = li
      // 分隔行内容不需要检查
      continue
    }

    if (cells[0] === '词汇' && cells[1] === '释义' && cells[2] === '语境理解') {
      headerLineIdx = li
      continue
    }

    // 数据行
    dataRows.push({ cells, lineIdx: li })
  }

  // ── 2. 表头检查 ──
  if (headerLineIdx === -1) {
    errors.push({ line: tableLineIndices[0] || 0, text: lines[tableLineIndices[0]] || '', reason: '表头行不存在或内容不对，必须为「|词汇 | 释义 | 语境理解 |」' })
  } else {
    const headerLine = lines[headerLineIdx].trim()
    // 检查表头格式冗余空格
    const normalized = headerLine.replace(/\s+/g, ' ').trim()
    if (normalized !== '|词汇 | 释义 | 语境理解 |') {
      errors.push({ line: headerLineIdx, text: headerLine, reason: '表头内容不匹配，应为「|词汇 | 释义 | 语境理解 |」' })
    }
  }

  // ── 3. 分隔行检查 ──
  if (sepLineIdx === -1) {
    errors.push({ line: tableLineIndices[1] || 0, text: lines[tableLineIndices[1]] || '', reason: '缺少分隔行「|------------|----------|----------|」' })
  } else {
    const sepLine = lines[sepLineIdx].trim()
    if (sepLine !== '|------------|----------|----------|') {
      errors.push({ line: sepLineIdx, text: sepLine, reason: '分隔行格式不匹配，应为「|------------|----------|----------|」' })
    }
  }

  // ── 4. 数据行数检查 ──
  if (dataRows.length === 0) {
    errors.push({ line: 0, text: '', reason: '没有数据行' })
  } else if (dataRows.length < 5) {
    errors.push({ line: 0, text: '', reason: `数据行不足：${dataRows.length} 行（至少 5 行）` })
  } else if (dataRows.length > 10) {
    errors.push({ line: 0, text: '', reason: `数据行过多：${dataRows.length} 行（最多 10 行）` })
  }

  // ── 5. 内容规则检查 ──
  for (const { cells, lineIdx } of dataRows) {
    const [col1, col2, col3] = cells

    // 5a. 第1列：只能英文/空格/连字符，不能含中文
    if (/[一-鿿]/.test(col1)) {
      errors.push({ line: lineIdx, text: lines[lineIdx].trim(), reason: `第1列含中文：「${col1}」，词汇列只能放英文` })
    }

    // 5b. 第2列：只能中文/分号，不能含英文单词
    if (/[a-zA-Z]{3,}/.test(col2)) {
      errors.push({ line: lineIdx, text: lines[lineIdx].trim(), reason: `第2列含英文：「${col2}」，释义列只能放中文` })
    }

    // 5c. 第3列：需包含语境说明，不能只是单词释义的重复
    if (!/[一-鿿]/.test(col3)) {
      errors.push({ line: lineIdx, text: lines[lineIdx].trim(), reason: '第3列无语境说明，需描述该词在段落中的具体含义' })
    }
    // 第3列太短（< 4 个中文字）说明语境不充分
    const cnChars = col3.match(/[一-鿿]/g) || []
    if (cnChars.length < 4) {
      errors.push({ line: lineIdx, text: lines[lineIdx].trim(), reason: `第3列语境说明过短（仅 ${cnChars.length} 个中文字），需补充具体语境` })
    }

    // 5d. 检查第3列是否只是简单重复第2列（如两者几乎相同）
    if (col3.trim().length > 0 && col2.trim().length > 0) {
      const similarity = longestCommonSubstring(col2, col3)
      if (similarity.length >= col2.trim().length * 0.6) {
        errors.push({ line: lineIdx, text: lines[lineIdx].trim(), reason: '第3列疑似只是第2列释义的重复，需要补充段落语境理解' })
      }
    }

    // ── 5e. 列合并检测：第1列含中文且第2列为空 → 第1、2列挤在一起了 ──
    if (/[一-鿿]/.test(col1) && col2.length === 0) {
      errors.push({ line: lineIdx, text: lines[lineIdx].trim(), reason: '列合并：第1列含中文内容但第2列为空，疑似词汇和释义挤在了第1列' })
    }

    // ── 5f. 列合并检测：第2列含英文且第3列为空 → 第2、3列挤在一起了 ──
    if (/[a-zA-Z]{3,}/.test(col2) && col3.length === 0) {
      errors.push({ line: lineIdx, text: lines[lineIdx].trim(), reason: '列合并：第2列含英文但第3列为空，疑似释义和语境理解挤在了第2列' })
    }

    // ── 5g. 第3列丢失：前两列有内容，第3列完全为空 ──
    if (col1.length > 0 && col2.length > 0 && col3.length === 0) {
      errors.push({ line: lineIdx, text: lines[lineIdx].trim(), reason: '第3列（语境理解）丢失，需要补充该词在段落中的具体语境说明' })
    }

    // ── 5h. 第2列内容过长 → 疑似释义列混入了语境内容 ──
    if (col2.length > 30 && col3.length < 4) {
      errors.push({ line: lineIdx, text: lines[lineIdx].trim(), reason: '第2列（释义）过长（疑似混入语境内容），第3列可能丢失或内容被合并' })
    }

    // ── 5i. 第1列含分隔符/表头残余 → 表头行和数据行挤在一行了 ──
    if (/[-|]{3,}/.test(col1) || col1 === '词汇' || col1 === '释义' || col1 === '语境理解') {
      errors.push({ line: lineIdx, text: lines[lineIdx].trim(), reason: '第1列疑似混入了表头或分隔符内容，可能多行合并到了一行' })
    }
  }

  return { valid: errors.length === 0, errors }
}

/** 最长公共子串长度（简单版） */
function longestCommonSubstring(a: string, b: string): string {
  let longest = ''
  const shorter = a.length < b.length ? a : b
  const longer = a.length < b.length ? b : a
  for (let i = 0; i < shorter.length; i++) {
    for (let j = i + 1; j <= shorter.length; j++) {
      const sub = shorter.slice(i, j)
      if (longer.includes(sub) && sub.length > longest.length) {
        longest = sub
      }
    }
  }
  return longest
}

/**
 * 构建表格修正 prompt（包含具体错误，指导 AI 精确修复）
 */
export function buildTableFixPrompt(
  tableText: string,
  errors: Array<{ line: number; text: string; reason: string }>,
): { system: string; user: string } {
  const errorList = errors.map(e => `- 第 ${e.line + 1} 行：${e.reason}`).join('\n')

  return {
    system: '你是 Markdown 表格修复工具。只修复格式和内容边界，不改变任何词汇的英文拼写、中文释义的核心意思。输出严格 3 列 GFMarkdown 表格，每行恰好 4 个竖线。直接从标题行开始输出，不要任何说明。遇到列合并问题时，必须将挤在一起的内容拆分到对应的列中。',
    user: `以下段落解释中的词汇表格存在格式问题，请修复。**保持所有词汇内容不变，只修复以下具体问题：**

${errorList}

## 修复要求

### 结构
- 标题固定为：\`### 二、难点词汇解析\`
- 表头固定为：\`|词汇 | 释义 | 语境理解 |\`
- 分隔行固定为：\`|------------|----------|----------|\`
- 每行必须有且仅有 3 列（4 个竖线），标题行、表头行、分隔行、数据行必须各自独立一行

### 列合并修复（重要）
- 如果一行中某列包含了应属于另一列的内容（如词汇列含中文、释义列含英文），必须将内容拆分到正确列
- 如果第1列同时包含英文词汇和中文释义，将中文部分移入第2列
- 如果第2列同时包含中文释义和语境说明，将语境部分移入第3列
- 任何列都不能为空：词汇必须有英文，释义必须有中文，语境必须有段落相关说明

### 列内容边界（严格）
- 第 1 列「词汇」：只放英文单词/短语，不含中文、不含释义、不含解释
- 第 2 列「释义」：只放简短中文释义（多义用分号隔开），不含英文、不含语境
- 第 3 列「语境理解」：只放该词在段落中的具体语境说明（中文），不能只是释义的重复

### 数据行数
提取 5～8 个最重要词汇，每行都填满 3 列内容，不能有空列。

## 待修复内容
${tableText}
`,
  }
}
