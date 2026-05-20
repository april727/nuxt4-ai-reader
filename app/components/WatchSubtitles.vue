<template>
  <div v-if="loading" class="subs-loading">
    <div class="mini-spinner"></div>
    <p>正在后台加载字幕...</p>
  </div>
  <template v-else>
    <SubtitleList
      :cues="cues"
      :active-cue-id="activeCueId"
      :practice="practice"
      :loop-cue-id="loopCueId"
      @cue-click="$emit('cueClick', $event)"
      @toggle-save="$emit('toggleSave', $event)"
      @toggle-loop="$emit('toggleLoop', $event)"
    />
    <PracticeList
      :cues="cues"
      :practice="practice"
      :active-cue-id="activeCueId"
      :loop-cue-id="loopCueId"
      @cue-click="$emit('cueClick', $event)"
      @toggle-loop="$emit('toggleLoop', $event)"
      @mark-mastered="$emit('markMastered', $event)"
      @remove="$emit('removePractice', $event)"
    />
  </template>
</template>

<script setup lang="ts">
import type { SubtitleCue, SubtitlePractice } from '#shared/types'

defineProps<{
  cues: SubtitleCue[]
  activeCueId: string | null
  practice: Record<string, SubtitlePractice>
  loopCueId: string | null
  loading: boolean
}>()

defineEmits<{
  cueClick: [cue: SubtitleCue]
  toggleSave: [cue: SubtitleCue]
  toggleLoop: [cue: SubtitleCue]
  markMastered: [cue: SubtitleCue]
  removePractice: [cue: SubtitleCue]
}>()
</script>

<style scoped>
.subs-loading {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; height: 200px; color: #a09e97; font-size: 13px;
}
</style>
