<template>
  <Teleport to="body">
    <Transition name="sn-fade">
      <div v-if="modelValue" class="sn-root" :style="{ zIndex }">
        <div
          class="sn-card"
          :class="{ dragging }"
          :style="{ left: pos.x + 'px', top: pos.y + 'px', background: color }"
        >
          <!-- 顶部胶带 -->
          <div class="sn-tape"></div>

          <!-- 头部：拖拽把手 -->
          <div
            class="sn-header"
            @mousedown="startDrag($event)"
            @touchstart.passive="startTouchDrag($event)"
            :title="dragging ? '' : '拖动移动便签'"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#b45309" stroke-width="1.5" class="sn-header-icon">
              <path d="M4 21V4h11l5 5v12z"/><polyline points="14 4 14 10 20 10"/>
            </svg>
            <span class="sn-title">便签</span>
            <span class="sn-subtitle" v-if="!dragging">拖动</span>
            <span class="sn-subtitle" v-else>移动中…</span>

            <div class="sn-header-actions">
              <div class="sn-color-wrap" ref="colorWrapRef">
                <button
                  class="sn-color-btn"
                  :style="{ background: color }"
                  @click.stop="showPalette = !showPalette"
                  title="便签背景色"
                ></button>
                <Transition name="sn-pop">
                  <div v-if="showPalette" class="sn-palette" @mousedown.stop @touchstart.stop>
                    <button
                      v-for="c in NOTE_COLORS"
                      :key="c.value"
                      class="sn-swatch"
                      :class="{ active: color === c.value }"
                      :style="{ background: c.value }"
                      :title="c.name"
                      @click="pickColor(c.value)"
                    ></button>
                  </div>
                </Transition>
              </div>
              <button class="sn-header-btn" @click.stop="clearContent" title="清空便签">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
              <button class="sn-header-btn" @click.stop="close" title="关闭便签">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          <!-- 编辑 / 预览 切换 -->
          <div class="sn-tabs">
            <button class="sn-tab" :class="{ active: viewMode === 'edit' }" @click="viewMode = 'edit'">编辑</button>
            <button class="sn-tab" :class="{ active: viewMode === 'preview' }" @click="viewMode = 'preview'">预览</button>
          </div>

          <!-- Markdown 快捷工具栏 -->
          <div v-if="viewMode === 'edit'" class="sn-mdbar">
            <button class="sn-md-btn" title="加粗 **文字**" @click="insertWrap('**', '**')"><b>B</b></button>
            <button class="sn-md-btn" title="斜体 *文字*" @click="insertWrap('*', '*')"><i>I</i></button>
            <button class="sn-md-btn" title="标题 # " @click="insertLine('# ')">H</button>
            <button class="sn-md-btn" title="列表 - " @click="insertLine('- ')"><span class="sn-md-dot">•</span></button>
            <button class="sn-md-btn" title="引用 > " @click="insertLine('> ')">❝</button>
            <button class="sn-md-btn" title="行内代码 `code`" @click="insertWrap('`', '`')"><span class="sn-md-code">&lt;/&gt;</span></button>
          </div>

          <!-- 编辑区 / 预览区 -->
          <textarea
            v-if="viewMode === 'edit'"
            ref="taRef"
            v-model="content"
            class="sn-text"
            placeholder="支持 Markdown：**加粗**、# 标题、- 列表、> 引用…"
            spellcheck="false"
          ></textarea>
          <div v-else class="sn-preview">
            <MarkdownRenderer v-if="content.trim()" :content="content" />
            <p v-else class="sn-preview-empty">暂无内容，切到「编辑」写点什么</p>
          </div>

          <!-- 底部状态 -->
          <div class="sn-foot">
            <span class="sn-foot-hint">Markdown 已保存</span>
            <span class="sn-foot-count">{{ content.length }} 字</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import MarkdownRenderer from '~/components/MarkdownRenderer.vue'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const CONTENT_KEY = 'sticky-note-single'
const POS_KEY = 'sticky-note-pos'
const zIndex = 5000

// ---- 内容 ----
const content = ref('')
const viewMode = ref<'edit' | 'preview'>('edit')
const taRef = ref<HTMLTextAreaElement | null>(null)

// ---- 背景色 ----
const COLOR_KEY = 'sticky-note-color'
const NOTE_COLORS = [
  { name: '白色', value: '#ffffff' },
  { name: '黄色', value: '#fff7c2' },
  { name: '粉色', value: '#ffe3ef' },
  { name: '蓝色', value: '#dceaff' },
  { name: '绿色', value: '#d9f4df' },
  { name: '紫色', value: '#ece7fd' },
  { name: '橙色', value: '#ffe9d6' },
]
const color = ref('#ffffff')
const showPalette = ref(false)
const colorWrapRef = ref<HTMLElement | null>(null)

watch(color, (val) => {
  try { localStorage.setItem(COLOR_KEY, val) } catch {}
})

function loadColor() {
  try {
    const saved = localStorage.getItem(COLOR_KEY)
    if (saved) color.value = saved
  } catch {}
}

function pickColor(value: string) {
  color.value = value
  showPalette.value = false
}

/** 点击便签以外区域时收起调色板 */
function onDocDown(e: MouseEvent) {
  const wrap = colorWrapRef.value
  if (wrap && !wrap.contains(e.target as Node)) showPalette.value = false
}

// 打开时读取内容
watch(() => props.modelValue, (open) => {
  if (open) {
    try { content.value = localStorage.getItem(CONTENT_KEY) || '' } catch {}
  }
}, { immediate: true })

// 输入即保存
watch(content, (val) => {
  try { localStorage.setItem(CONTENT_KEY, val) } catch {}
})

// ---- 位置（可自由拖动）----
const pos = ref({ x: 0, y: 0 })
const dragging = ref(false)
let dragOffset = { x: 0, y: 0 }

function loadPos() {
  try {
    const saved = localStorage.getItem(POS_KEY)
    if (saved) {
      const p = JSON.parse(saved)
      if (typeof p?.x === 'number' && typeof p?.y === 'number') {
        pos.value = clampPos(p)
        return
      }
    }
  } catch {}
  // 默认：右上角（顶栏下方）
  pos.value = clampPos({
    x: (typeof window !== 'undefined' ? window.innerWidth : 1024) - 340,
    y: 76,
  })
}

function clampPos(p: { x: number; y: number }) {
  if (typeof window === 'undefined') return { x: 12, y: 76 }
  const w = 320 // 便签宽度（含边距）
  const h = 420 // 估计高度
  return {
    x: Math.min(Math.max(8, p.x), Math.max(8, window.innerWidth - w - 8)),
    y: Math.min(Math.max(8, p.y), Math.max(8, window.innerHeight - h - 8)),
  }
}

function savePos() {
  try { localStorage.setItem(POS_KEY, JSON.stringify(pos.value)) } catch {}
}

function startDrag(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('button')) return
  e.preventDefault()
  dragging.value = true
  dragOffset = { x: e.clientX - pos.value.x, y: e.clientY - pos.value.y }
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragEnd)
}

let touchId: number | null = null
function startTouchDrag(e: TouchEvent) {
  const t = e.touches[0]
  if (!t) return
  if ((e.target as HTMLElement).closest('button')) return
  touchId = t.identifier
  dragging.value = true
  dragOffset = { x: t.clientX - pos.value.x, y: t.clientY - pos.value.y }
  window.addEventListener('touchmove', onTouchMove, { passive: false })
  window.addEventListener('touchend', onDragEnd)
  window.addEventListener('touchcancel', onDragEnd)
}

function onDragMove(e: MouseEvent) {
  if (!dragging.value) return
  pos.value = clampPos({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y })
}

function onTouchMove(e: TouchEvent) {
  if (!dragging.value || touchId === null) return
  e.preventDefault()
  const t = Array.from(e.touches).find(x => x.identifier === touchId)
  if (!t) return
  pos.value = clampPos({ x: t.clientX - dragOffset.x, y: t.clientY - dragOffset.y })
}

function onDragEnd() {
  if (!dragging.value) return
  dragging.value = false
  touchId = null
  savePos()
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
  window.removeEventListener('touchmove', onTouchMove)
  window.removeEventListener('touchend', onDragEnd)
  window.removeEventListener('touchcancel', onDragEnd)
}

// ---- Markdown 快捷插入 ----
function insertWrap(before: string, after: string) {
  const ta = taRef.value
  if (!ta) return
  const s = ta.selectionStart
  const e = ta.selectionEnd
  const sel = content.value.slice(s, e)
  content.value = content.value.slice(0, s) + before + sel + after + content.value.slice(e)
  nextTick(() => {
    ta.focus()
    ta.setSelectionRange(s + before.length, s + before.length + sel.length)
  })
}

function insertLine(prefix: string) {
  const ta = taRef.value
  if (!ta) return
  const s = ta.selectionStart
  const lineStart = content.value.lastIndexOf('\n', s - 1) + 1
  content.value = content.value.slice(0, lineStart) + prefix + content.value.slice(lineStart)
  nextTick(() => {
    ta.focus()
    ta.setSelectionRange(lineStart + prefix.length, lineStart + prefix.length)
  })
}

// ---- 操作 ----
function clearContent() {
  if (content.value && !confirm('确定清空便签内容？')) return
  content.value = ''
}

function close() {
  emit('update:modelValue', false)
}

// ---- 初始化 ----
onMounted(() => {
  loadPos()
  loadColor()
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragEnd)
  document.addEventListener('mousedown', onDocDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
  window.removeEventListener('touchmove', onTouchMove)
  window.removeEventListener('touchend', onDragEnd)
  window.removeEventListener('touchcancel', onDragEnd)
  document.removeEventListener('mousedown', onDocDown)
})
</script>

<style scoped>
.sn-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
}

/* ---- 便签卡片 ---- */
.sn-card {
  position: fixed;
  width: 300px;
  min-height: 320px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.16), 0 2px 8px rgba(0, 0, 0, 0.06);
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  transition: box-shadow 0.2s;
}
.sn-card.dragging {
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.22);
}

/* 胶带 */
.sn-tape {
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%) rotate(-2deg);
  width: 58px;
  height: 16px;
  background: rgba(253, 224, 71, 0.55);
  border-radius: 2px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  z-index: 2;
}

/* ---- 头部（拖拽把手）---- */
.sn-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 11px 12px 9px;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  flex-shrink: 0;
}
.sn-card.dragging .sn-header { cursor: grabbing; }
.sn-header-icon { flex-shrink: 0; }
.sn-title {
  font-family: 'Lora', Georgia, serif;
  font-size: 13px;
  font-weight: 500;
  color: #1a1a18;
  letter-spacing: 0.01em;
}
.sn-subtitle {
  font-size: 10.5px;
  color: #b0ada4;
  margin-left: 2px;
}
.sn-header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}
.sn-header-btn {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #a09e97;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.sn-header-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #4a4640;
}

/* ---- 背景色选择 ---- */
.sn-color-wrap { position: relative; }
.sn-color-btn {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  cursor: pointer;
  transition: box-shadow 0.15s;
  box-sizing: border-box;
}
.sn-color-btn:hover {
  box-shadow: 0 0 0 2px rgba(61, 53, 145, 0.18);
}
.sn-palette {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  padding: 8px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  z-index: 20;
}
.sn-swatch {
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  cursor: pointer;
  transition: transform 0.12s, box-shadow 0.12s;
  box-sizing: border-box;
}
.sn-swatch:hover { transform: scale(1.12); }
.sn-swatch.active {
  box-shadow: 0 0 0 2px #3d3591;
  border-color: #3d3591;
}
.sn-pop-enter-active { transition: opacity 0.12s, transform 0.12s; }
.sn-pop-leave-active { transition: opacity 0.1s, transform 0.1s; }
.sn-pop-enter-from,
.sn-pop-leave-to { opacity: 0; transform: translateY(-4px); }

/* ---- Tab 切换 ---- */
.sn-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 12px 0;
  flex-shrink: 0;
}
.sn-tab {
  padding: 4px 14px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #8a877c;
  font-size: 12px;
  font-weight: 450;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.sn-tab:hover { color: #4a4640; }
.sn-tab.active {
  background: #f0eefb;
  color: #3d3591;
  font-weight: 500;
}

/* ---- Markdown 工具栏 ---- */
.sn-mdbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 7px 12px 4px;
  flex-shrink: 0;
}
.sn-md-btn {
  min-width: 26px;
  height: 26px;
  padding: 0 6px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 7px;
  background: #fafaf8;
  color: #6b6963;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s;
  font-family: 'DM Mono', monospace;
}
.sn-md-btn:hover {
  background: #f0eefb;
  border-color: rgba(61, 53, 145, 0.2);
  color: #3d3591;
}
.sn-md-btn b { font-family: inherit; }
.sn-md-btn i { font-family: inherit; }
.sn-md-dot { font-size: 14px; line-height: 1; }
.sn-md-code { font-size: 10px; letter-spacing: -0.5px; }

/* ---- 编辑 / 预览 ---- */
.sn-text {
  flex: 1;
  min-height: 190px;
  padding: 10px 14px 6px;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  font-family: 'DM Sans', sans-serif;
  font-size: 13px;
  line-height: 1.65;
  color: #1a1a18;
}
.sn-text::placeholder { color: #c0bdb4; }

.sn-preview {
  flex: 1;
  min-height: 190px;
  max-height: 380px;
  overflow-y: auto;
  padding: 8px 14px;
  font-size: 13px;
}
.sn-preview-empty {
  color: #c0bdb4;
  font-size: 12.5px;
  margin: 10px 0;
}

/* ---- 底部 ---- */
.sn-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px 9px;
  flex-shrink: 0;
}
.sn-foot-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  color: #b0ada4;
}
.sn-foot-hint::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #34d399;
}
.sn-foot-count {
  font-size: 10.5px;
  color: #b0ada4;
  font-family: 'DM Mono', monospace;
}

/* ---- 动画 ---- */
.sn-fade-enter-active,
.sn-fade-leave-active {
  transition: opacity 0.18s ease;
}
.sn-fade-enter-active .sn-card,
.sn-fade-leave-active .sn-card {
  transition: transform 0.2s ease, opacity 0.18s ease;
}
.sn-fade-enter-from,
.sn-fade-leave-to {
  opacity: 0;
}
.sn-fade-enter-from .sn-card,
.sn-fade-leave-to .sn-card {
  transform: scale(0.9) rotate(-2deg);
  opacity: 0;
}
</style>
