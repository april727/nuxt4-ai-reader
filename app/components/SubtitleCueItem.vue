<template>
  <div
    class="cue-item"
    :class="{
      active: isActive, saved: isSaved,
      'loop-start': isLoopStart,
      'loop-end': isLoopEnd,
      'loop-range': isInLoopRange && !isLoopStart && !isLoopEnd,
    }"
    :data-cue-id="cue.id"
    @click="$emit('click', cue)"
  >
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
        :class="{ active: isLoopStart || isLoopEnd }"
        @click="$emit('toggle-loop', cue)"
        :title="isLoopStart && isLoopEnd ? '取消区间循环' : isLoopStart ? '点击设置循环终点' : isLoopEnd ? '取消区间循环' : isInLoopRange ? '取消区间循环' : '设置循环起点'"
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
  isLoopStart: boolean
  isLoopEnd: boolean
  isInLoopRange: boolean
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
/* ============================================================
   基础布局 — 紧凑间距
   ============================================================ */
.cue-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  cursor: pointer;
  border-radius: 8px;
  transition:
    background 0.45s ease,
    padding 0.4s ease;
  position: relative;
}

.cue-item:hover {
  background: #f6f5f2;
}

/* ============================================================
   Active 状态 — 渐变底 + 字号放大，无竖条
   ============================================================ */
.cue-item.active {
  background: linear-gradient(
    105deg,
    #f0edfa 0%,
    #f8f6fd 50%,
    #fdfcff 100%
  );
  padding: 10px 14px;
}

/* ============================================================
   内容区
   ============================================================ */
.cue-content {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 16px;
}

.cue-time {
  flex-shrink: 0;
  font-family: 'DM Mono', monospace;
  font-size: 11px;
  color: #a09e97;
  width: 34px;
  transition:
    color 0.45s ease,
    font-size 0.4s ease;
}
.cue-item.active .cue-time {
  color: #3d3591;
  font-size: 12.5px;
}

.cue-text {
  font-family: 'Lora', Georgia, serif;
  font-size: 14px;
  line-height: 1.65;
  color: #a09e97;
  word-break: break-word;
  transition:
    color 0.45s ease,
    font-size 0.4s ease,
    line-height 0.4s ease;
  letter-spacing: 0.01em;
}
.cue-item.active .cue-text {
  color: #3d3591;
  font-size: 18px;
  line-height: 1.55;
}

.cue-item:hover .cue-text {
  color: #8a8880;
}
.cue-item.active:hover .cue-text {
  color: #3d3591;
}

/* ============================================================
   操作按钮
   ============================================================ */
.cue-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.2s ease;
}
.cue-item:hover .cue-actions { opacity: 1; }
.cue-item.active .cue-actions { opacity: 1; }

.cue-btn {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 0.5px solid rgba(0,0,0,0.08);
  background: rgba(255,255,255,0.9);
  color: #b0ad9d;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
}
.cue-btn:hover { color: #3d3591; border-color: rgba(61,53,145,0.25); background: #faf9ff; }
.cue-btn.saved { color: #f59e0b; background: #fffbeb; border-color: #fde68a; }
.loop-btn.active { color: #10b981; background: #ecfdf5; border-color: #a7f3d0; }

/* 循环区间高亮 */
.cue-item.loop-start,
.cue-item.loop-end {
  background: #ecfdf5;
  border-radius: 8px;
}
.cue-item.loop-range {
  background: #f0fdf4;
  border-radius: 0;
}
.cue-item.loop-start { border-radius: 8px 8px 0 0; }
.cue-item.loop-end { border-radius: 0 0 8px 8px; }
.cue-item.loop-start.loop-end { border-radius: 8px; }
</style>
