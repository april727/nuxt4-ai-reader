<template>
  <Teleport to="body">
    <Transition name="tc-fade">
      <div
        v-if="visible"
        class="translate-card"
        :style="cardStyle"
        @mouseenter="cancelTimer"
        @mouseleave="startTimer"
      >
        <div class="tc-header" @mousedown="startDrag">
          <span>翻译（可拖动）</span>
          <button class="tc-close" @click.stop="close">&times;</button>
        </div>
        <div class="tc-body">
          <p v-if="loading" class="tc-loading">翻译中...</p>
          <p v-else class="tc-text">{{ text }}</p>
        </div>
        <div v-if="leaving" class="tc-bar"></div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{
  visible: boolean
  text: string
  loading: boolean
  position: { x: number; y: number }
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const cardX = ref(0)
const cardY = ref(0)
const leaving = ref(false)
let leaveTimer: ReturnType<typeof setTimeout> | null = null

watch(() => props.visible, (v) => {
  if (v) {
    cardX.value = Math.min(props.position.x, window.innerWidth - 340)
    cardY.value = props.position.y
    leaving.value = false
    cancelTimer()
  }
})

function cancelTimer() {
  leaving.value = false
  if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null }
}

function startTimer() {
  if (props.loading) return
  leaving.value = true
  leaveTimer = setTimeout(() => emit('close'), 3000)
}

function close() {
  cancelTimer(); emit('close')
}

// 拖拽
let dragging = false; let dx = 0; let dy = 0
function startDrag(e: MouseEvent) {
  dragging = true; dx = e.clientX - cardX.value; dy = e.clientY - cardY.value
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
}
function onDrag(e: MouseEvent) {
  if (!dragging) return
  cardX.value = Math.max(0, Math.min(e.clientX - dx, window.innerWidth - 100))
  cardY.value = Math.max(0, Math.min(e.clientY - dy, window.innerHeight - 60))
}
function stopDrag() {
  dragging = false
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
}

onUnmounted(() => { cancelTimer(); stopDrag() })

const cardStyle = computed(() => ({
  left: `${cardX.value}px`, top: `${cardY.value}px`,
}))
</script>

<style scoped>
.translate-card {
  position: fixed;
  z-index: 2500;
  width: 320px;
  max-width: calc(100vw - 32px);
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}
.tc-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 14px; background: #6366f1; color: #ffffff;
  font-size: 12px; font-weight: 600; cursor: grab;
}
.tc-header:active { cursor: grabbing; }
.tc-close {
  width: 22px; height: 22px; border: none; border-radius: 50%;
  background: rgba(255,255,255,0.2); color: #ffffff; font-size: 14px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.tc-close:hover { background: rgba(255,255,255,0.35); }
.tc-body { padding: 14px; }
.tc-loading { color: #94a3b8; font-size: 13px; }
.tc-text { font-size: 13px; line-height: 1.7; color: #334155; }
.tc-bar {
  height: 3px;
  background: linear-gradient(90deg, #6366f1, #a78bfa, transparent);
  animation: barShrink 3s linear forwards;
}
@keyframes barShrink { from { width: 100%; } to { width: 0%; } }
.tc-fade-enter-active { transition: opacity 0.2s, transform 0.2s; }
.tc-fade-leave-active { transition: opacity 0.15s, transform 0.15s; }
.tc-fade-enter-from { opacity: 0; transform: translateY(-8px); }
.tc-fade-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
