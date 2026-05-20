<template>
  <div class="acb" @click="seekFromBar">
    <button class="acb-play" @click.stop="toggle" :title="playing ? '暂停' : '播放'">
      <svg v-if="!playing" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
    </button>
    <span class="acb-time">{{ formatTime(current) }}</span>
    <div class="acb-track">
      <div class="acb-progress" :style="{ width: percent + '%' }"></div>
    </div>
    <span class="acb-time">{{ formatTime(duration) }}</span>
    <div class="acb-volume-wrap">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
      </svg>
      <input type="range" min="0" max="100" :value="volume" @input.stop="setVolume" class="acb-volume" />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  current: number
  duration: number
  playing: boolean
  volume: number
}>()

const emit = defineEmits<{
  toggle: []
  seek: [time: number]
  setVolume: [v: number]
}>()

const percent = computed(() => props.duration > 0 ? (props.current / props.duration) * 100 : 0)

function seekFromBar(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).querySelector('.acb-track')!.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  emit('seek', ratio * props.duration)
}

function setVolume(e: Event) {
  emit('setVolume', parseInt((e.target as HTMLInputElement).value))
}

const toggle = () => emit('toggle')

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}
</script>

<style scoped>
.acb {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: #fff;
  border-bottom: 1px solid #e8e6e0;
  flex-shrink: 0;
  height: 44px;
}

.acb-play {
  flex-shrink: 0;
  width: 30px; height: 30px;
  border: none; border-radius: 50%;
  background: #3d3591; color: #fff;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
}
.acb-play:hover { background: #322b7a; }

.acb-time {
  font-family: 'DM Mono', monospace;
  font-size: 0.75rem;
  color: #888;
  min-width: 36px;
  text-align: center;
  flex-shrink: 0;
}

.acb-track {
  flex: 1; height: 5px;
  background: #e8e6e0; border-radius: 3px;
  cursor: pointer; position: relative;
}
.acb-track:hover { background: #ddd; }

.acb-progress {
  height: 100%;
  background: #3d3591;
  border-radius: 3px;
  transition: width 0.1s linear;
}

.acb-volume-wrap {
  display: flex; align-items: center; gap: 4px;
  color: #aaa; flex-shrink: 0;
}
.acb-volume {
  width: 60px; height: 3px;
  accent-color: #3d3591;
  cursor: pointer;
}
</style>
