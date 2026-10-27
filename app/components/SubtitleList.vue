<template>
  <div class="subtitle-list" ref="listRef">
    <div class="sl-header">
      <span class="sl-title">字幕</span>
      <div class="sl-header-right">
        <button
          v-if="cues.length > 0"
          class="sl-copy-btn"
          :class="{ copied }"
          :title="copied ? '已复制' : '复制全部字幕'"
          @click="copySubtitles"
        >
          <svg v-if="!copied" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </button>
        <button
          v-if="cues.length > 0"
          class="sl-reupload-btn"
          title="替换字幕"
          @click="$emit('reupload')"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </button>
        <span class="sl-count">{{ cues.length }} 句</span>
      </div>
    </div>

    <div
      class="sl-cues"
      :class="{ 'has-active': activeCueId !== null }"
      ref="cuesContainerRef"
    >
      <SubtitleCueItem
        v-for="cue in cues"
        :key="cue.id"
        :cue="cue"
        :is-active="cue.id === activeCueId"
        :is-saved="!!practice[cue.id]"
        :is-loop-start="loopCueId === cue.id"
        :is-loop-end="loopEndCueId === cue.id"
        :is-in-loop-range="isCueInLoopRange(cue)"
        @click="handleCueClick"
        @toggle-save="handleToggleSave"
        @toggle-loop="handleToggleLoop"
      />
    </div>

    <div v-if="cues.length === 0" class="sl-empty">
      <p>暂无字幕</p>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Cue {
  id: string; index: number; start: number; end: number; text: string
}
interface Practice {
  cueId: string; repeatCount: number; mastered: boolean; lastPracticed: string
}

const props = defineProps<{
  cues: Cue[]
  activeCueId: string | null
  practice: Record<string, Practice>
  loopCueId: string | null
  loopEndCueId: string | null
}>()

function isCueInLoopRange(cue: Cue): boolean {
  if (!props.loopCueId || !props.loopEndCueId) return false
  const startIdx = props.cues.findIndex(c => c.id === props.loopCueId)
  const endIdx = props.cues.findIndex(c => c.id === props.loopEndCueId)
  if (startIdx === -1 || endIdx === -1) return false
  const minIdx = Math.min(startIdx, endIdx)
  const maxIdx = Math.max(startIdx, endIdx)
  return cue.index >= minIdx && cue.index <= maxIdx
}

const emit = defineEmits<{
  'cue-click': [cue: Cue]
  'toggle-save': [cue: Cue]
  'toggle-loop': [cue: Cue]
  reupload: []
}>()

const listRef = ref<HTMLElement | null>(null)
const cuesContainerRef = ref<HTMLElement | null>(null)

// 自动滚动到当前活跃字幕 —— 仅当字幕即将离开可视区时才滚，避免频繁跳动
watch(() => props.activeCueId, (cueId) => {
  if (!cueId || !cuesContainerRef.value) return
  const el = cuesContainerRef.value.querySelector(`[data-cue-id="${cueId}"]`) as HTMLElement | null
  if (!el) return

  const container = cuesContainerRef.value
  const containerRect = container.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()

  // 字幕顶部留 30% 的缓冲区，底部留 20%
  const topThreshold = containerRect.top + containerRect.height * 0.3
  const bottomThreshold = containerRect.bottom - containerRect.height * 0.2

  // 只有当字幕超出阈值区域时才滚动
  if (elRect.top < topThreshold || elRect.bottom > bottomThreshold) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
})

function handleCueClick(cue: Cue) {
  emit('cue-click', cue)
}

function handleToggleSave(cue: Cue) {
  emit('toggle-save', cue)
}

function handleToggleLoop(cue: Cue) {
  emit('toggle-loop', cue)
}

// 一键复制全部字幕内容
const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null
async function copySubtitles() {
  const text = props.cues.map(c => c.text).join('\n')
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 旧浏览器兜底
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  copied.value = true
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copied.value = false }, 1500)
}
onBeforeUnmount(() => { if (copyTimer) clearTimeout(copyTimer) })
</script>

<style scoped>
.subtitle-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #ffffff;
}

.sl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  flex-shrink: 0;
  border-bottom: 0.5px solid rgba(0,0,0,0.06);
}

.sl-title {
  font-size: 12.5px;
  font-weight: 600;
  color: #1a1a18;
}

.sl-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sl-copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: #b0ad9d;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.sl-copy-btn:hover {
  color: #3d3591;
  background: #f5f3ff;
}
.sl-copy-btn.copied {
  color: #10b981;
  background: #ecfdf5;
}

.sl-reupload-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: #b0ad9d;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.sl-reupload-btn:hover {
  color: #3d3591;
  background: #f5f3ff;
}

.sl-count {
  font-size: 11px;
  color: #a09e97;
  font-family: 'DM Mono', monospace;
}

.sl-cues {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
}

/* 当存在 active 字幕时，非 active 字幕更轻柔地后退，让视线自然落向当前行 */
.sl-cues.has-active :deep(.cue-item:not(.active) .cue-text) {
  color: #b2afa8;
  transition: color 0.6s ease;
}

.sl-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #b0ae9f;
  font-size: 13px;
}
</style>
