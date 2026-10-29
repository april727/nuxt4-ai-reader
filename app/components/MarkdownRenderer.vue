<template>
  <div ref="rootEl" class="markdown-renderer prose" :class="{ 'image-resizable': imageResizable }" v-html="renderedHtml" @click="onContentClick"></div>
  <Teleport to="body">
    <div
      v-if="resizeImg && !isStreaming"
      class="rm-slider"
      :style="{ left: resizeImg.x + 'px', top: resizeImg.y + 'px' }"
      @mousedown.stop
      @touchstart.stop
    >
      <div class="rm-slider-head">
        <span class="rm-slider-label">图片宽度</span>
        <button class="rm-slider-reset" @click="resetWidth" title="恢复原始宽度">原宽</button>
        <span class="rm-slider-val">{{ resizeImg.width }}%</span>
      </div>
      <input
        class="rm-range"
        type="range"
        min="10"
        max="100"
        step="5"
        :value="resizeImg.width"
        @input="onSliderInput"
        @change="onSliderCommit"
      >
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { marked } from 'marked'
import { splitStreamContent, escapeHtml } from '~/utils/streamBuffer'
import { applyFigureGroups } from '~/utils/figureGroups'

const props = defineProps<{
  content: string
  isStreaming?: boolean
  imageResizable?: boolean
}>()
const emit = defineEmits<{ (e: 'resize-image', p: { src: string; width: string }): void }>()

const resizeImg = ref<{ src: string; width: number; x: number; y: number } | null>(null)
// 当前被调节的 <img> 元素（非响应式，避免把 DOM 节点包进 reactive）
let activeImgEl: HTMLImageElement | null = null

/** 点击内容里的图片 → 在图片底部弹出宽度滑块；点击非图片区域 → 收起 */
function onContentClick(e: MouseEvent) {
  if (!props.imageResizable) return
  const img = (e.target as HTMLElement).closest?.('img') as HTMLImageElement | null
  if (!img) {
    closeSlider()
    return
  }
  const src = img.getAttribute('src') || ''
  if (!src) return
  e.preventDefault()
  const r = img.getBoundingClientRect()
  const container = img.closest('.markdown-renderer') as HTMLElement | null
  // 初始值：优先取已有 =NN% 标记；否则按当前显示宽度相对容器的百分比近似
  let cur = 100
  const stw = img.style.width || ''
  const m = stw.match(/^(\d+(?:\.\d+)?)%/)
  if (m) {
    cur = Math.min(100, Math.max(10, Math.round(Number(m[1]))))
  } else if (container && container.clientWidth > 0) {
    cur = Math.min(100, Math.max(10, Math.round((r.width / container.clientWidth) * 100)))
  }
  const barW = 224
  const barH = 64
  const x = Math.max(8, Math.min(r.left + r.width / 2 - barW / 2, window.innerWidth - barW - 8))
  const y = r.bottom + 6 + barH > window.innerHeight ? Math.max(6, r.top - barH - 6) : r.bottom + 6
  activeImgEl = img
  resizeImg.value = { src, width: cur, x, y }
}
function closeSlider() {
  activeImgEl = null
  resizeImg.value = null
}
/** 拖动中：实时改图片 CSS 宽度做预览（不动源内容） */
function onSliderInput(e: Event) {
  if (!resizeImg.value) return
  const v = Number((e.target as HTMLInputElement).value) || 0
  resizeImg.value.width = v
  if (activeImgEl) {
    activeImgEl.style.width = v + '%'
    activeImgEl.style.maxWidth = '100%'
    activeImgEl.style.height = 'auto'
  }
}
/** 松手：把最终宽度写回 Markdown 源并保存 */
function onSliderCommit() {
  if (!resizeImg.value) return
  emit('resize-image', { src: resizeImg.value.src, width: `${resizeImg.value.width}%` })
  closeSlider()
}
/** 恢复原始宽度：移除尺寸标记 */
function resetWidth() {
  if (!resizeImg.value) return
  emit('resize-image', { src: resizeImg.value.src, width: 'auto' })
  closeSlider()
}
function onDocMouseDown(e: MouseEvent) {
  if (!resizeImg.value) return
  if (!(e.target as HTMLElement).closest?.('.rm-slider')) closeSlider()
}
watch(resizeImg, (open) => {
  if (open) document.addEventListener('mousedown', onDocMouseDown)
  else document.removeEventListener('mousedown', onDocMouseDown)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocMouseDown)
  activeImgEl = null
})

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

/** 图组：连续的纯图片段落合并成横排（逻辑见 utils/figureGroups.ts） */
let groupTimer: ReturnType<typeof setTimeout> | null = null
const rootEl = ref<HTMLElement | null>(null)

function runFigureGroups() {
  if (rootEl.value) applyFigureGroups(rootEl.value)
}
function scheduleFigureGroups() {
  if (groupTimer) clearTimeout(groupTimer)
  groupTimer = setTimeout(() => {
    groupTimer = null
    runFigureGroups()
  }, 120)
}

onMounted(() => {
  runFigureGroups()
  // 图片解码晚于 mounted，补两次即可覆盖（markdown 图片是 eager 加载的）
  scheduleFigureGroups()
  setTimeout(scheduleFigureGroups, 600)
})
onUnmounted(() => {
  if (groupTimer) clearTimeout(groupTimer)
})

const renderedHtml = computed(() => {
  if (!props.content) return ''
  try {
    // 流式过程中：块级缓冲——已完成块交 marked 解析，进行中块保留纯文本
    if (props.isStreaming) {
      const { completed, pending } = splitStreamContent(props.content)
      let md = completed
      md = md.replace(/([^\n])\n(\|[^\n]+\|\s*\n\|[-: |]+\|)/g, '$1\n\n$2')
      md = normalizeTables(md)
      md = md.replace(/!\[([^\]]*)\]\(([^\n=]+)\s*=\s*(\d+%?)\)/g, (_, alt, src, size) => {
        const s = size.endsWith('%') ? `style="width:${size};max-width:100%"` : `width="${size}"`
        return `<img src="${src.trim()}" alt="${alt}" ${s}>`
      })
      const completedHtml = marked.parse(md, { breaks: true, gfm: true, html: true }) as string
      const pendingHtml = pending
        ? `<span class="streaming-pending">${escapeHtml(pending)}</span>`
        : ''
      return completedHtml + pendingHtml
    }

    // 非流式：全量解析
    let md = props.content
    md = md.replace(/([^\n])\n(\|[^\n]+\|\s*\n\|[-: |]+\|)/g, '$1\n\n$2')
    md = normalizeTables(md)
    md = md.replace(/!\[([^\]]*)\]\(([^\n=]+)\s*=\s*(\d+%?)\)/g, (_, alt, src, size) => {
      const s = size.endsWith('%') ? `style="width:${size};max-width:100%"` : `width="${size}"`
      return `<img src="${src.trim()}" alt="${alt}" ${s}>`
    })
    return marked.parse(md, { breaks: true, gfm: true, html: true }) as string
  } catch {
    return props.content.replace(/\n/g, '<br>')
  }
})

// v-html 重渲染会重建 DOM，分组标记随之丢失 —— 每次内容变化后重新套用
watch(renderedHtml, () => nextTick(scheduleFigureGroups))
</script>

<style scoped>
.markdown-renderer {
  line-height: 1.75;
  color: #334155;
}
.markdown-renderer :deep(.streaming-pending) {
  opacity: 0.45;
  white-space: pre-wrap;
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

/* ── 竖图组（连续插入的书页切图）──
   等分列宽 + 每张等比缩放：三张竖图一定并排，不会换行成 2+1。
   关键是不给 img 设 width:100%（那会让每张按原宽占满一行，变回竖向堆叠），
   而是 max-width/max-height 双向约束，宽度由列宽决定、比例自己保住。 */
.markdown-renderer :deep(.md-figure-group) {
  display: grid;
  grid-template-columns: repeat(var(--md-fig-cols, 3), minmax(0, 1fr));
  gap: 8px;
  align-items: start;
  justify-items: center;
  margin: 14px 0;
}
.markdown-renderer :deep(.md-figure) {
  margin: 0;
  width: 100%;
  display: flex;
  justify-content: center;
}
.markdown-renderer :deep(.md-figure img) {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: min(50vh, 520px);
}
.markdown-renderer.image-resizable :deep(img) {
  cursor: pointer;
}
.markdown-renderer.image-resizable :deep(img):hover {
  outline: 2px solid rgba(99, 102, 241, 0.55);
  outline-offset: 2px;
  border-radius: 4px;
}
.rm-slider {
  position: fixed;
  z-index: 9999;
  width: 224px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.16);
  padding: 8px 12px 10px;
  user-select: none;
}
.rm-slider-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}
.rm-slider-label {
  font-size: 11px;
  color: #94a3b8;
  flex: 1;
}
.rm-slider-reset {
  border: none;
  background: transparent;
  color: #818cf8;
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}
.rm-slider-reset:hover {
  color: #3d3591;
  text-decoration: underline;
}
.rm-slider-val {
  font-size: 12px;
  font-weight: 600;
  color: #3d3591;
  min-width: 34px;
  text-align: right;
}
.rm-range {
  width: 100%;
  accent-color: #6366f1;
  cursor: pointer;
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

@media (max-width: 760px) {
  /* 窄屏放不下一排，改成横滑查看（像翻书页），比换行成 2+1 好读 */
  .markdown-renderer :deep(.md-figure-group) {
    grid-auto-flow: column;
    grid-auto-columns: 46vw;
    grid-template-columns: none;
    justify-content: start;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x proximity;
    padding-bottom: 4px;
  }
  .markdown-renderer :deep(.md-figure) { scroll-snap-align: start; }
  .markdown-renderer :deep(.md-figure img) { max-height: 46vh; }
}
</style>
