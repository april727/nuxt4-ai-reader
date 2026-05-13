<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="paragraph-toolbar"
      :style="toolbarStyle"
      @mouseenter="cancelHide"
      @mouseleave="scheduleHide"
    >
      <button class="tb-btn" title="翻译" @click="handleAction('translate')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/>
        </svg>
        <span>翻译</span>
      </button>
      <button class="tb-btn" title="理解" @click="handleAction('explain')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span>理解</span>
      </button>
      <button class="tb-btn" title="编辑" @click="handleEdit">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
        </svg>
        <span>编辑</span>
      </button>
      <button class="tb-btn" title="复制" @click="handleCopy">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        <span>复制</span>
      </button>
      <button class="tb-btn" title="搜索" @click="handleAction('search')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <span>搜索</span>
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { ParagraphAction } from '#shared/types'

const props = defineProps<{
  paragraphId: string
  paragraphText: string
  position: { x: number; y: number }
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'action', action: ParagraphAction, paragraphId: string, paragraphText: string): void
  (e: 'hide'): void
  (e: 'enter'): void
  (e: 'leave'): void
  (e: 'edit', paragraphId: string): void
}>()

// 定位到段落右上角内侧
const toolbarStyle = computed(() => ({
  left: `${props.position.x}px`,
  top: `${props.position.y}px`,
}))

let hideTimer: ReturnType<typeof setTimeout> | null = null

function scheduleHide() {
  emit('leave')
  hideTimer = setTimeout(() => { emit('hide') }, 400)
}

function cancelHide() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
  emit('enter')
}

function handleAction(action: ParagraphAction) {
  emit('action', action, props.paragraphId, props.paragraphText)
  emit('hide')
}

function handleEdit() {
  emit('edit', props.paragraphId)
  emit('hide')
}

async function handleCopy() {
  try { await navigator.clipboard.writeText(props.paragraphText) } catch {
    const ta = document.createElement('textarea')
    ta.value = props.paragraphText
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
  }
  emit('hide')
}

onUnmounted(() => { if (hideTimer) clearTimeout(hideTimer) })
</script>

<style scoped>
.paragraph-toolbar {
  position: fixed;
  z-index: 1000;
  display: flex;
  gap: 2px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 4px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06);
  transform: translate(-100%, 6px);
  pointer-events: auto;
}

.tb-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #475569;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.tb-btn:hover { background: #f1f5f9; color: #6366f1; }
.tb-btn svg { flex-shrink: 0; }
</style>
