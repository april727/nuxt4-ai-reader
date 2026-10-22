/**
 * 流式文本缓冲器 — 将流式内容拆分为「已完成块」和「进行中块」
 *
 * 已完成块：可以安全交给 marked 解析
 * 进行中块：还在流式中，结构不完整，暂以纯文本显示
 *
 * 支持的块类型：表格、代码块
 */

/**
 * HTML 转义
 */
export function escapeHtml(str: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }
  return str.replace(/[&<>"']/g, c => map[c])
}

/** 验证表格块是否完整 */
function isTableComplete(tableLines: string[]): boolean {
  if (tableLines.length < 2) return false

  const header = tableLines[0]
  const separator = tableLines[1]

  // 必须有表头
  const headerCols = header.split('|').filter(s => s.trim()).length
  if (headerCols < 2) return false

  // 必须有分隔行
  if (!separator.includes('---')) return false
  const sepCols = separator.split('|').filter(s => s.trim()).length
  if (sepCols !== headerCols) return false

  // 必须有至少一行数据
  if (tableLines.length < 3) return false

  // 所有数据行都有完整的列数
  for (let i = 2; i < tableLines.length; i++) {
    const cols = tableLines[i].split('|').filter(s => s.trim()).length
    if (cols !== headerCols) return false
  }

  return true
}

export function splitStreamContent(text: string): {
  completed: string   // 可以安全交给 marked 解析的部分
  pending: string     // 还在流式中的不完整块
} {
  const lines = text.split('\n')

  let inTable = false
  let tableStartIndex = -1
  let inCodeBlock = false
  let codeBlockStartIndex = -1
  let completedEndIndex = lines.length

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 代码块开闭检测
    if (line.trimStart().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeBlockStartIndex = i
        continue
      } else {
        // 代码块闭合
        inCodeBlock = false
        continue
      }
    }
    if (inCodeBlock) continue

    // 表格开始检测
    if (!inTable && line.trimStart().startsWith('|')) {
      inTable = true
      tableStartIndex = i
      continue
    }

    // 表格进行中
    if (inTable) {
      if (!line.trimStart().startsWith('|')) {
        // 遇到非 | 行，表格可能结束
        // 跳过空行继续检测
        if (line.trim() === '') continue

        // 非空非表格行 → 表格结束
        const tableLines = lines.slice(tableStartIndex, i)
        if (isTableComplete(tableLines)) {
          inTable = false
          tableStartIndex = -1
        } else {
          // 不完整 → 截断
          completedEndIndex = tableStartIndex
          break
        }
      }
    }
  }

  // 流结束时的收尾判断
  if (inTable && tableStartIndex !== -1) {
    const tableLines = lines.slice(tableStartIndex)
    if (!isTableComplete(tableLines)) {
      completedEndIndex = tableStartIndex
    }
  }

  if (inCodeBlock && codeBlockStartIndex !== -1) {
    // 找最后一个 ``` 的位置
    for (let i = lines.length - 1; i > codeBlockStartIndex; i--) {
      if (lines[i].trim().startsWith('```')) {
        completedEndIndex = i + 1
        break
      }
    }
    if (completedEndIndex === lines.length) {
      completedEndIndex = codeBlockStartIndex
    }
  }

  return {
    completed: lines.slice(0, completedEndIndex).join('\n'),
    pending: lines.slice(completedEndIndex).join('\n'),
  }
}
