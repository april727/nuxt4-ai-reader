<template>
  <div
    class="cue-item"
    :class="{ active: isActive, saved: isSaved, 'loop-active': isLooping }"
    :data-cue-id="cue.id"
    @click="$emit('click', cue)"
  >
    <div class="cue-indicator" :class="{ active: isActive }"></div>
    <div class="cue-content">
      <span class="cue-time">{{ formatTime(cue.start) }}</span>
      <span class="cue-text">{{ cue.text }}</span>
    </div>
    <div class="cue-actions" @click.stop>
      <button
        class="cue-btn"
        :class="{ saved: isSaved }"
        @click="$emit('toggle-save', cue)"
        :title="isSaved ? '从精听移除' : '保存到精听'"
      >
        <svg v-if="isSaved" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
        <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      </button>
      <button
        class="cue-btn loop-btn"
        :class="{ active: isLooping }"
        @click="$emit('toggle-loop', cue)"
        :title="isLooping ? '取消循环' : '单句循环'"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Cue {
  id: string; index: number; start: number; end: number; text: string
}

const props = defineProps<{
  cue: Cue
  isActive: boolean
  isSaved: boolean
  isLooping: boolean
}>()

defineEmits<{
  click: [cue: Cue]
  'toggle-save': [cue: Cue]
  'toggle-loop': [cue: Cue]
}>()

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
</script>

<style scoped>
.cue-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.12s;
  position: relative;
}
.cue-item:hover { background: #f5f4f0; }
.cue-item.active {
  background: #edeafd;
}
.cue-item.active .cue-indicator {
  background: #3d3591;
}

.cue-indicator {
  width: 3px;
  height: 100%;
  min-height: 28px;
  border-radius: 2px;
  background: transparent;
  flex-shrink: 0;
  transition: background 0.15s;
  margin-top: 2px;
}

.cue-content {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 10px;
}

.cue-time {
  flex-shrink: 0;
  font-family: 'DM Mono', monospace;
  font-size: 11px;
  color: #3d3591;
  padding-top: 2px;
  width: 36px;
}

.cue-text {
  font-family: 'Lora', Georgia, serif;
  font-size: 14px;
  line-height: 1.7;
  color: #4a4a46;
  word-break: break-word;
}
.cue-item.active .cue-text {
  color: #1a1a18;
}

.cue-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.12s;
  padding-top: 1px;
}
.cue-item:hover .cue-actions { opacity: 1; }
.cue-item.active .cue-actions { opacity: 1; }

.cue-btn {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 0.5px solid rgba(0,0,0,0.1);
  background: rgba(255,255,255,0.85);
  color: #aba89a;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.12s;
}
.cue-btn:hover { color: #3d3591; border-color: rgba(61,53,145,0.3); }
.cue-btn.saved { color: #f59e0b; background: #fffbeb; border-color: #fde68a; }
.loop-btn.active { color: #10b981; background: #ecfdf5; border-color: #a7f3d0; }
</style>
