<template>
  <div class="article-panel">
    <div v-if="title" class="article-header">
      <h1 class="article-title">{{ title }}</h1>
      <div class="article-meta">
        <span v-if="analysis?.tone" class="article-tone">{{ analysis.tone }}</span>
        <span class="article-stats">{{ paragraphs.length }} 段 · {{ totalChars }} 字</span>
        <span v-if="readingPosition" class="article-pos">
          ← 上次读到第 {{ readingPosIdx }} 段
          <button @click="jumpToPosition">跳转</button>
        </span>
      </div>
    </div>

    <div class="article-body" ref="bodyRef">
      <div
        v-for="p in paragraphs"
        :key="p.id"
        :data-id="p.id"
        class="paragraph"
        :class="{ 'is-active': activeParagraphId === p.id, 'is-editing': editingId === p.id }"
        @click="handleParagraphClick(p, $event)"
        @mouseup="handleTextSelect(p)"
      >
        <!-- 段落序号 -->
        <span
          class="paragraph-index"
          :class="{ 'pos-marker': readingPosition?.paragraphId === p.id }"
          @click.stop="$emit('set-position', p.id)"
          :title="readingPosition?.paragraphId === p.id ? '当前阅读位置' : '点击标记阅读位置'"
        >{{ p.index + 1 }}</span>

        <!-- 编辑模式 -->
        <template v-if="editingId === p.id">
          <textarea v-model="editText" class="paragraph-edit" rows="3"
            @keydown.escape="cancelEdit"
            @keydown.meta.enter="saveEdit(p)"
            @keydown.ctrl.enter="saveEdit(p)"
          ></textarea>
          <div class="edit-actions">
            <button class="btn-ghost" @click="cancelEdit">取消</button>
            <button class="btn-primary" @click="saveEdit(p)">保存</button>
          </div>
        </template>

        <!-- 正常模式：高亮标记文字 -->
        <p v-else class="paragraph-text" v-html="renderMarkedText(p)"></p>

        <!-- 段内工具条（幽灵风格，icon-only） -->
        <div v-if="editingId !== p.id" class="para-toolbar" @click.stop>
          <button class="ptb-btn" @click.stop="$emit('paragraph-action','explain',p.id,p.text)" title="理解">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </button>
          <button class="ptb-btn" @click.stop="startEdit(p.id)" title="编辑">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
          <button class="ptb-btn" @click.stop="doCopy(p.text)" title="复制">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        </div>
      </div>

      <div v-if="paragraphs.length === 0 && !loading" class="empty-state">
        <p>上传或粘贴文章，AI 将自动分段显示</p>
      </div>
    </div>

    <!-- 选中文字标记工具条 -->
    <Teleport to="body">
      <div v-if="selToolbar.visible" class="sel-toolbar" :style="selToolbarStyle">
        <button class="sel-btn" style="--c:#f59e0b" @click="createMark('word')" title="标记为生词">
          <span class="sel-label">词</span><span class="sel-hint">标记</span>
        </button>
        <button class="sel-btn" style="--c:#10b981" @click="createMark('phrase')" title="标记为短语">
          <span class="sel-label">短</span><span class="sel-hint">标记</span>
        </button>
        <button class="sel-btn" style="--c:#06b6d4" @click="createMark('sentence')" title="标记为句子">
          <span class="sel-label">句</span><span class="sel-hint">标记</span>
        </button>
        <button class="sel-btn" style="--c:#ec4899" @click="$emit('create-note', selToolbar.paraId, selToolbar.text, selToolbar.startOffset, selToolbar.endOffset); selToolbar.visible=false; window.getSelection()?.removeAllRanges()" title="轻标记（临时）">
          <span class="sel-label">记</span><span class="sel-hint">临时</span>
        </button>
        <button class="sel-btn" style="--c:#8b5cf6" @click="doSelTranslate" title="翻译选中内容">
          <span class="sel-label">译</span><span class="sel-hint">临时</span>
        </button>
        <button class="sel-btn" style="--c:#3b82f6" @click="doPronounce" :title="selPlaying ? '播放中' : '发音'">
          <span v-if="selPlaying" class="sel-playing"><span></span><span></span><span></span></span>
          <span v-else class="sel-label">▶</span>
          <span class="sel-hint">发音</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import type { Paragraph, ParagraphAction, Mark, ReadingPosition, MarkType, MARK_COLORS } from '#shared/types'

const props = defineProps<{
  paragraphs: Paragraph[]
  activeParagraphId: string | null
  loading: boolean
  title: string
  analysis: any
  marks: Mark[]
  readingPosition: ReadingPosition | null
}>()

const emit = defineEmits<{
  (e: 'paragraph-action', action: ParagraphAction, paragraphId: string, paragraphText: string): void
  (e: 'quick-translate', text: string, position: { x: number; y: number }): void
  (e: 'edit-segment', paragraphId: string, newText: string): void
  (e: 'create-mark', paragraphId: string, text: string, type: MarkType, startOffset: number, endOffset: number): void
  (e: 'create-note', paragraphId: string, text: string, startOffset: number, endOffset: number): void
  (e: 'pronounce', word: string): void
  (e: 'set-position', paragraphId: string): void
  (e: 'show-mark', mark: Mark): void
}>()

const bodyRef = ref<HTMLElement | null>(null)
const editingId = ref<string | null>(null)
const editText = ref('')
let clickTimer: ReturnType<typeof setTimeout> | null = null
let pendingClickParagraph: Paragraph | null = null

const readingPosIdx = computed(() => {
  if (!props.readingPosition) return 0
  return props.paragraphs.findIndex(p => p.id === props.readingPosition!.paragraphId) + 1
})

const totalChars = computed(() => props.paragraphs.reduce((sum, p) => sum + p.text.length, 0))

// 选中文字标记
const selToolbar = reactive({ visible: false, x: 0, y: 0, text: '', paraId: '', startOffset: 0, endOffset: 0 })
const selPlaying = ref(false)
let selPlayTimer: ReturnType<typeof setTimeout> | null = null

function doPronounce() {
  if (selPlaying.value) return
  selPlaying.value = true
  emit('pronounce', selToolbar.text)
  selPlayTimer = setTimeout(() => { selPlaying.value = false }, 2500)
}
const selToolbarStyle = computed(() => {
  const x = Math.max(150, Math.min(selToolbar.x, window.innerWidth - 170))
  const y = Math.max(8, selToolbar.y - 50)
  return { left: x + 'px', top: y + 'px' }
})

function handleTextSelect(p: Paragraph) {
  setTimeout(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      selToolbar.visible = false
      return
    }
    const text = sel.toString().trim()
    if (text.length < 2 || text.length > 300) { selToolbar.visible = false; return }

    const range = sel.getRangeAt(0)
    const paraEl = (sel.anchorNode?.parentElement)?.closest('.paragraph-text')
    if (!paraEl) { selToolbar.visible = false; return }

    // 遍历 DOM 树计算绝对 offset（兼容 <mark> 标签）
    const startOffset = getTextOffset(paraEl, range.startContainer, range.startOffset)
    const endOffset = getTextOffset(paraEl, range.endContainer, range.endOffset)
    if (startOffset < 0 || endOffset < 0) return

    const rect = range.getBoundingClientRect()
    selToolbar.visible = true
    selToolbar.x = rect.left + rect.width / 2
    selToolbar.y = rect.top
    selToolbar.text = text
    selToolbar.paraId = p.id
    selToolbar.startOffset = startOffset
    selToolbar.endOffset = endOffset
  }, 10)
}

function getTextOffset(root: Element, targetNode: Node, nodeOffset: number): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let offset = 0
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (node === targetNode) return offset + nodeOffset
    offset += (node.textContent || '').length
  }
  return -1
}

function createMark(type: MarkType) {
  emit('create-mark', selToolbar.paraId, selToolbar.text, type, selToolbar.startOffset, selToolbar.endOffset)
  selToolbar.visible = false
  window.getSelection()?.removeAllRanges()
}

// 渲染标记文字 — 逐段转义，避免 escapeHtml 导致 offset 偏移
function renderMarkedText(p: Paragraph): string {
  const raw = p.text
  const allMarks = props.marks
    .filter(m => m.paragraphId === p.id)
    .sort((a, b) => a.startOffset - b.startOffset)

  // 去重重叠标记（从前往后，先出现的优先）
  const filt: typeof allMarks = []
  const covered: Array<{ s: number; e: number }> = []
  for (const m of allMarks) {
    const overlaps = covered.some(c => m.startOffset < c.e && m.endOffset > c.s)
    if (!overlaps) {
      filt.push(m)
      covered.push({ s: m.startOffset, e: m.endOffset })
    }
  }

  let html = ''
  let pos = 0
  for (const m of filt) {
    html += escapeHtml(raw.slice(pos, m.startOffset))
    html += `<mark class="hl-${m.type}" data-mark-id="${m.id}" style="background:${m.color}22;border-bottom:2px solid ${m.color};cursor:pointer;border-radius:2px;padding:1px 0">${escapeHtml(raw.slice(m.startOffset, m.endOffset))}</mark>`
    pos = m.endOffset
  }
  html += escapeHtml(raw.slice(pos))
  return html
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 点击段落 → 理解
function handleParagraphClick(p: Paragraph, e: MouseEvent) {
  if (editingId.value) return
  // 点击标记文字 → 打开 MarkPopup
  const target = e.target as HTMLElement
  if (target.tagName === 'MARK') {
    const mid = target.dataset.markId
    const mark = props.marks.find(m => m.id === mid)
    if (mark && mark.type !== 'note') { emit('show-mark', mark); return }
  }
  if (clickTimer) clearTimeout(clickTimer)
  const sel = window.getSelection()
  if (sel && !sel.isCollapsed) return
  pendingClickParagraph = p
  clickTimer = setTimeout(() => {
    if (pendingClickParagraph) {
      emit('paragraph-action', 'explain', pendingClickParagraph.id, pendingClickParagraph.text)
      pendingClickParagraph = null
    }
  }, 300)
}

function jumpToPosition() {
  if (!props.readingPosition) return
  const el = bodyRef.value?.querySelector(`[data-id="${props.readingPosition.paragraphId}"]`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// 编辑
function startEdit(pid: string) {
  const para = props.paragraphs.find(pp => pp.id === pid)
  if (!para) return; editingId.value = pid; editText.value = para.text
}
function cancelEdit() { editingId.value = null; editText.value = '' }
function saveEdit(p: Paragraph) {
  const t = editText.value.trim(); if (t && t !== p.text) emit('edit-segment', p.id, t)
  editingId.value = null; editText.value = ''
}
async function doSelTranslate() {
  emit('quick-translate', selToolbar.text, { x: selToolbar.x, y: selToolbar.y })
  selToolbar.visible = false
  window.getSelection()?.removeAllRanges()
}

async function doCopy(text: string) {
  try { await navigator.clipboard.writeText(text) } catch {}
}

onUnmounted(() => { if (clickTimer) clearTimeout(clickTimer); if (selPlayTimer) clearTimeout(selPlayTimer) })
</script>

<style scoped>
/* 段落序号位置标记 */
.paragraph-index { transition: all 0.25s; }
.paragraph-index.pos-marker {
  background: #93c5fd !important;
  color: #ffffff !important;
  box-shadow: 0 0 0 4px rgba(147,197,253,0.25);
  animation: pulsePos 2s infinite;
}
@keyframes pulsePos {
  0%, 100% { box-shadow: 0 0 0 4px rgba(147,197,253,0.25); }
  50% { box-shadow: 0 0 0 10px rgba(147,197,253,0); }
}

/* 选中文字标记工具条 */
.sel-toolbar {
  position: fixed; z-index: 1500;
  display: flex; gap: 6px;
  background: #ffffff; border: 1px solid #e2e8f0;
  border-radius: 12px; padding: 8px 10px;
  box-shadow: 0 8px 30px rgba(0,0,0,0.14);
  transform: translate(-50%, 0);
}
.sel-btn {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  min-width: 46px; padding: 6px 8px;
  border: 2px solid transparent; border-radius: 10px;
  background: #f8fafc;
  cursor: pointer; transition: all 0.15s;
}
.sel-label {
  font-size: 15px; font-weight: 700; color: var(--c);
}
.sel-hint {
  font-size: 10px; color: #94a3b8; line-height: 1;
}
.sel-playing { display: flex; align-items: flex-end; gap: 2px; height: 14px; }
.sel-playing span { width: 3px; background: #3b82f6; border-radius: 1px; animation: selBarAnim 0.7s infinite ease-in-out alternate; }
.sel-playing span:nth-child(1) { height: 8px; animation-delay: 0s; }
.sel-playing span:nth-child(2) { height: 14px; animation-delay: 0.12s; }
.sel-playing span:nth-child(3) { height: 10px; animation-delay: 0.24s; }
@keyframes selBarAnim { from { transform: scaleY(0.4); opacity: 0.5; } to { transform: scaleY(1); opacity: 1; } }
.sel-btn:hover { background: #ffffff; border-color: var(--c); transform: scale(1.05); box-shadow: 0 2px 8px rgba(0,0,0,0.06); }

/* 标记高亮样式 */
:deep(mark.hl-word) { background: #f59e0b22; border-bottom-color: #f59e0b; }
:deep(mark.hl-phrase) { background: #10b98122; border-bottom-color: #10b981; }
:deep(mark.hl-sentence) { background: #06b6d422; border-bottom-color: #06b6d4; }
:deep(mark:hover) { filter: brightness(0.92); }

/* 段内工具条 — 幽灵风格 icon-only */
.para-toolbar {
  position: absolute; top: -28px; right: 4px;
  display: flex; gap: 1px;
  background: transparent;
  opacity: 0; pointer-events: none;
  transition: opacity 0.25s; z-index: 10;
}
.paragraph:hover .para-toolbar { opacity: 1; pointer-events: auto; }
.ptb-btn {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px;
  border: none; border-radius: 50%;
  background: transparent; color: #cbd5e1;
  cursor: pointer; transition: all 0.2s;
}
.ptb-btn:hover { background: rgba(99,102,241,0.08); color: #6366f1; }
.ptb-btn svg { flex-shrink: 0; }

.paragraph.is-editing { flex-direction: column; padding: 12px 16px; }
.paragraph-edit { width: 100%; padding: 10px 14px; border: 1.5px solid #6366f1; border-radius: 8px; font-family: inherit; font-size: 0.95em; line-height: 1.7; color: #334155; resize: vertical; outline: none; }
.edit-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
</style>
