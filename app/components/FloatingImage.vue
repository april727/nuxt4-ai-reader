<template>
  <Teleport to="body">
    <div
      class="fi-card"
      :style="cardStyle"
      :class="{ 'fi-hover': showControls }"
      @mouseenter="showControls = true"
      @mouseleave="showControls = false"
      @mousedown="startDrag"
      @wheel.prevent="handleWheel"
    >
      <img :src="src" class="fi-img" draggable="false" />

      <Transition name="fi-fade">
        <button v-if="showControls" class="fi-close" @click.stop="close" title="关闭 (Esc)">×</button>
      </Transition>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{ src: string; title?: string }>()
const emit = defineEmits<{ close: [] }>()

const x = ref(0)
const y = ref(0)
const baseW = ref(640)   // 基础宽度
const zoom = ref(1)
const showControls = ref(true)

const cardStyle = computed(() => {
  const w = baseW.value * zoom.value
  return { left: `${x.value}px`, top: `${y.value}px`, width: `${w}px` }
})

function close() { emit('close') }

onMounted(() => {
  baseW.value = Math.min(window.innerWidth * 0.5, 480)
  x.value = window.innerWidth - baseW.value - 40
  y.value = 120
  // 几秒后自动隐藏控件
  setTimeout(() => { showControls.value = false }, 3000)
})

// ── 键盘 ──
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
  if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn() }
  if (e.key === '-') { e.preventDefault(); zoomOut() }
  if (e.key === '0') { e.preventDefault(); resetZoom() }
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

// ── 拖拽 ──
let dragging = false; let dx = 0; let dy = 0
function startDrag(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('button')) return
  e.preventDefault()
  dragging = true; dx = e.clientX - x.value; dy = e.clientY - y.value
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
}
function onDrag(e: MouseEvent) {
  if (!dragging) return
  x.value = Math.max(-200, e.clientX - dx)
  y.value = Math.max(0, e.clientY - dy)
}
function stopDrag() {
  dragging = false
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
}

// ── 滚轮缩放 ──
function handleWheel(e: WheelEvent) {
  const delta = e.deltaY > 0 ? -0.1 : 0.1
  const newZoom = Math.max(0.1, Math.min(10, zoom.value + delta))
  // 以鼠标位置为中心缩放
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const mx = e.clientX - rect.left
  const ratio = mx / (baseW.value * zoom.value)
  const oldW = baseW.value * zoom.value
  const newW = baseW.value * newZoom
  x.value += (oldW - newW) * ratio
  zoom.value = newZoom
}
function zoomIn() { zoom.value = Math.min(10, zoom.value + 0.25) }
function zoomOut() { zoom.value = Math.max(0.1, zoom.value - 0.25) }
function resetZoom() { zoom.value = 1 }
</script>

<style scoped>
.fi-card {
  position: fixed; z-index: 9999;
  user-select: none; cursor: grab;
  box-shadow: 0 4px 24px rgba(0,0,0,0.25);
  border-radius: 4px; overflow: hidden;
}
.fi-card:active { cursor: grabbing; }
.fi-img {
  width: 100%; display: block; user-select: none;
  pointer-events: none;
}

.fi-close {
  position: absolute; top: 6px; right: 6px;
  width: 22px; height: 22px; border: none; border-radius: 50%;
  background: rgba(0,0,0,0.35); cursor: pointer;
  font-size: 13px; color: rgba(255,255,255,0.8);
  display: flex; align-items: center; justify-content: center;
  line-height: 1;
}
.fi-close:hover { background: rgba(0,0,0,0.55); color: #fff; }

.fi-fade-enter-active, .fi-fade-leave-active { transition: opacity 0.2s; }
.fi-fade-enter-from, .fi-fade-leave-to { opacity: 0; }
</style>
