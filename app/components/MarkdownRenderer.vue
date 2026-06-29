<template>
  <div class="markdown-renderer prose" v-html="renderedHtml"></div>
</template>

<script setup lang="ts">
import { marked } from 'marked'

const props = defineProps<{
  content: string
}>()

/** 规范化 AI 生成的表格：修复列数不一致、行首空列等问题 */
function normalizeTables(md: string): string {
  const lines = md.split('\n')
  const result: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // 检测表格头部行（以 | 开头且有分隔行紧随其后）
    if (/^\|.+\|/.test(line) && i + 1 < lines.length && /^\|[-: |]+\|/.test(lines[i + 1])) {
      const headerRow = line
      const sepRow = lines[i + 1]
      // 用分隔行确定列数（最可靠）
      const colCount = sepRow.split('|').filter(c => c.trim()).length
      const bodyRows: string[] = []
      let j = i + 2
      while (j < lines.length && /^\|/.test(lines[j])) {
        bodyRows.push(lines[j])
        j++
      }
      // 规范化每一行
      function fixRow(row: string): string {
        let cells = row.split('|')
        // 去掉首尾空串
        if (cells[0].trim() === '') cells.shift()
        if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop()
        cells = cells.map(c => c.trim())
        // 对齐到目标列数
        while (cells.length < colCount) cells.push('')
        cells = cells.slice(0, colCount)
        return '| ' + cells.join(' | ') + ' |'
      }
      result.push(fixRow(headerRow))
      result.push(fixRow(sepRow))
      for (const br of bodyRows) result.push(fixRow(br))
      i = j
      continue
    }
    result.push(line)
    i++
  }
  return result.join('\n')
}

const renderedHtml = computed(() => {
  if (!props.content) return ''
  try {
    let md = props.content
    md = md.replace(/([^\n])\n(\|[^\n]+\|\s*\n\|[-: |]+\|)/g, '$1\n\n$2')
    md = normalizeTables(md)
    // 扩展图片语法：![alt](url =300) → 固定宽，![alt](url =50%) → 百分比
    md = md.replace(/!\[([^\]]*)\]\(([^\n=]+)\s*=\s*(\d+%?)\)/g, (_, alt, src, size) => {
      const s = size.endsWith('%') ? `style="width:${size};max-width:100%"` : `width="${size}"`
      return `<img src="${src.trim()}" alt="${alt}" ${s}>`
    })
    return marked.parse(md, { breaks: true, gfm: true, html: true }) as string
  } catch {
    return props.content.replace(/\n/g, '<br>')
  }
})
</script>

<style scoped>
.markdown-renderer {
  line-height: 1.75;
  color: #334155;
}

.markdown-renderer :deep(h1),
.markdown-renderer :deep(h2),
.markdown-renderer :deep(h3),
.markdown-renderer :deep(h4) {
  margin-top: 1.2em;
  margin-bottom: 0.5em;
  font-weight: 600;
  color: #1e293b;
}

.markdown-renderer :deep(h2) { font-size: 1.2em; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.35em; }
.markdown-renderer :deep(h3) { font-size: 1.05em; }
.markdown-renderer :deep(p) { margin: 0.6em 0; }
.markdown-renderer :deep(strong) { font-weight: 600; color: #0f172a; }
.markdown-renderer :deep(ul), .markdown-renderer :deep(ol) { padding-left: 1.5em; margin: 0.5em 0; }
.markdown-renderer :deep(li) { margin: 0.25em 0; }
.markdown-renderer :deep(code) {
  background: #f1f5f9;
  padding: 0.15em 0.4em;
  border-radius: 4px;
  font-size: 0.9em;
  color: #c026d3;
}
.markdown-renderer :deep(pre) {
  background: #1e293b;
  color: #e2e8f0;
  padding: 1em;
  border-radius: 8px;
  overflow-x: auto;
  margin: 0.8em 0;
}
.markdown-renderer :deep(pre code) {
  background: none;
  color: inherit;
  padding: 0;
}
.markdown-renderer :deep(blockquote) {
  border-left: 3px solid #6366f1;
  padding-left: 1em;
  margin: 0.8em 0;
  color: #64748b;
}
.markdown-renderer :deep(a) {
  color: #6366f1;
  text-decoration: underline;
}
.markdown-renderer :deep(img) {
  max-width: 100%; height: auto;
}
.markdown-renderer :deep(table) {
  border-collapse: collapse;
  margin: 0.8em 0;
  max-width: 100%;
  display: block;
  overflow-x: auto;
}
.markdown-renderer :deep(th), .markdown-renderer :deep(td) {
  border: 1px solid #e2e8f0;
  padding: 0.5em 0.75em;
  text-align: left;
}
.markdown-renderer :deep(th) {
  background: #f8fafc;
  font-weight: 600;
}
</style>
