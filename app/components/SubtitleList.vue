<template>
  <div class="subtitle-list" ref="listRef">
    <div class="sl-header">
      <span class="sl-title">字幕</span>
      <span class="sl-count">{{ cues.length }} 句</span>
    </div>

    <div class="sl-cues" ref="cuesContainerRef">
      <SubtitleCueItem
        v-for="cue in cues"
        :key="cue.id"
        :cue="cue"
        :is-active="cue.id === activeCueId"
        :is-saved="!!practice[cue.id]"
        :is-looping="loopCueId === cue.id"
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
}>()

const emit = defineEmits<{
  'cue-click': [cue: Cue]
  'toggle-save': [cue: Cue]
  'toggle-loop': [cue: Cue]
}>()

const listRef = ref<HTMLElement | null>(null)
const cuesContainerRef = ref<HTMLElement | null>(null)

// 自动滚动到当前活跃字幕
watch(() => props.activeCueId, (cueId) => {
  if (!cueId || !cuesContainerRef.value) return
  const el = cuesContainerRef.value.querySelector(`[data-cue-id="${cueId}"]`)
  if (el) {
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

.sl-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #b0ae9f;
  font-size: 13px;
}
</style>
