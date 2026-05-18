<template>
  <div class="practice-list" :class="{ collapsed: isCollapsed }">
    <div class="pl-header" @click="isCollapsed = !isCollapsed">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
      <span class="pl-title">精听列表</span>
      <span class="pl-count">{{ savedCues.length }} 句</span>
      <span class="pl-arrow">{{ isCollapsed ? '▶' : '▼' }}</span>
    </div>

    <div v-if="!isCollapsed" class="pl-body">
      <!-- 未掌握 -->
      <div v-if="pendingCues.length > 0" class="pl-group">
        <div class="pl-group-label">待掌握 ({{ pendingCues.length }})</div>
        <div
          v-for="item in pendingCues"
          :key="item.cue.id"
          class="pl-item"
          :class="{ active: item.cue.id === activeCueId }"
          @click="$emit('cue-click', item.cue)"
        >
          <span class="pl-item-time">{{ formatTime(item.cue.start) }}</span>
          <span class="pl-item-text">{{ item.cue.text }}</span>
          <div class="pl-item-actions">
            <span class="pl-repeat" title="重复次数">{{ item.practice.repeatCount }}×</span>
            <button class="pl-btn loop-btn" :class="{ active: loopCueId === item.cue.id }" @click.stop="$emit('toggle-loop', item.cue)" title="循环">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>
            <button class="pl-btn mastered-btn" @click.stop="$emit('mark-mastered', item.cue)" title="标记掌握">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- 已掌握 -->
      <div v-if="masteredCues.length > 0" class="pl-group">
        <div class="pl-group-label mastered-label">已掌握 ({{ masteredCues.length }})</div>
        <div
          v-for="item in masteredCues"
          :key="item.cue.id"
          class="pl-item mastered"
          @click="$emit('cue-click', item.cue)"
        >
          <span class="pl-item-time">{{ formatTime(item.cue.start) }}</span>
          <span class="pl-item-text">{{ item.cue.text }}</span>
          <button class="pl-btn remove-btn" @click.stop="$emit('remove', item.cue)" title="移除">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <div v-if="savedCues.length === 0" class="pl-empty">
        <p>点击字幕旁的 ⭐ 保存到精听列表</p>
      </div>
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
  practice: Record<string, Practice>
  activeCueId: string | null
  loopCueId: string | null
}>()

const emit = defineEmits<{
  'cue-click': [cue: Cue]
  'toggle-loop': [cue: Cue]
  'mark-mastered': [cue: Cue]
  remove: [cue: Cue]
}>()

const isCollapsed = ref(false)

// 已保存的字幕
const savedCues = computed(() => {
  return props.cues.filter(c => props.practice[c.id])
})

// 分组
const pendingCues = computed(() => {
  return savedCues.value
    .filter(c => !props.practice[c.id]?.mastered)
    .map(c => ({ cue: c, practice: props.practice[c.id] }))
})

const masteredCues = computed(() => {
  return savedCues.value
    .filter(c => props.practice[c.id]?.mastered)
    .map(c => ({ cue: c, practice: props.practice[c.id] }))
})

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
</script>

<style scoped>
.practice-list {
  border-top: 0.5px solid rgba(0,0,0,0.08);
  background: #fafaf8;
}

.pl-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 14px;
  cursor: pointer;
  color: #6b6963;
  font-size: 12px;
  transition: background 0.12s;
  user-select: none;
}
.pl-header:hover { background: #f5f4f0; }

.pl-title { font-weight: 500; color: #4a4a46; }
.pl-count { font-family: 'DM Mono', monospace; font-size: 11px; color: #a09e97; margin-left: auto; }
.pl-arrow { font-size: 9px; color: #c0bdb4; margin-left: 4px; }

.pl-body {
  max-height: 300px;
  overflow-y: auto;
  padding: 0 14px 10px;
}

.pl-group { margin-bottom: 10px; }

.pl-group-label {
  font-size: 10.5px;
  font-weight: 500;
  color: #b0ae9f;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
  padding-left: 2px;
}
.mastered-label { color: #10b981; }

.pl-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
  font-size: 12px;
}
.pl-item:hover { background: #f0efe9; }
.pl-item.active { background: #edeafd; }
.pl-item.mastered { opacity: 0.6; }

.pl-item-time {
  font-family: 'DM Mono', monospace;
  font-size: 10px;
  color: #3d3591;
  flex-shrink: 0;
  width: 30px;
}

.pl-item-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #4a4a46;
}

.pl-item-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.pl-repeat {
  font-family: 'DM Mono', monospace;
  font-size: 10px;
  color: #f59e0b;
  min-width: 18px;
}

.pl-btn {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: #aba89a;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.12s;
}
.pl-btn:hover { background: rgba(0,0,0,0.06); color: #4a4a46; }
.loop-btn.active { color: #10b981; background: #ecfdf5; }
.mastered-btn:hover { color: #10b981; }
.remove-btn:hover { color: #b84b2e; }

.pl-empty {
  padding: 20px 10px;
  text-align: center;
  color: #b0ae9f;
  font-size: 12px;
}
</style>
