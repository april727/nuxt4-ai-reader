<template>
  <Teleport to="body">
    <Transition name="popup-fade">
      <div v-if="visible" class="word-popup-overlay" @click.self="close">
        <div
          ref="popupEl"
          class="word-popup"
          :style="popupStyle"
        >
          <!-- 可拖拽标题栏 -->
          <div class="wp-header" @mousedown="startDrag">
            <span class="wp-word">{{ detail.word }}</span>
            <button class="wp-close" @click.stop="close">&times;</button>
          </div>

          <div v-if="detail.phonetic" class="wp-phonetic">
            <span class="wp-phonetic-text">{{ detail.phonetic }}</span>
            <button class="wp-pronounce" :class="{ playing: isPlaying }" @click="pronounce">
              <!-- 播放中动画 -->
              <span v-if="isPlaying" class="playing-bars">
                <span></span><span></span><span></span>
              </span>
              <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5,3 19,12 5,21"/>
              </svg>
              <span>{{ isPlaying ? '播放中' : '发音' }}</span>
            </button>
          </div>

          <div v-if="detail.definition" class="wp-definition">
            {{ detail.definition }}
          </div>

          <div v-if="detail.example" class="wp-example">
            <span class="wp-example-label">例句：</span>
            <em>{{ detail.example }}</em>
          </div>

          <div v-if="loading" class="wp-loading">
            <div class="spinner-sm"></div>
            <span>查询中...</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import type { WordDetail } from '#shared/types'

const props = defineProps<{
  visible: boolean
  detail: WordDetail
  loading: boolean
  position: { x: number; y: number }
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'pronounce', word: string): void
}>()

const popupEl = ref<HTMLElement | null>(null)
const isPlaying = ref(false)
let playTimer: ReturnType<typeof setTimeout> | null = null

// 弹窗位置（可拖拽）
const popupX = ref(0)
const popupY = ref(0)
let dragging = false
let dragStartX = 0
let dragStartY = 0
let startLeft = 0
let startTop = 0

// 初始化位置，约束在视口内
function clampPosition(x: number, y: number) {
  const pw = 320
  const w = window.innerWidth
  const h = window.innerHeight
  popupX.value = Math.max(0, Math.min(x - pw / 2, w - pw - 16))
  popupY.value = Math.max(0, Math.min(y + 20, h - 280))
}

watch(() => props.visible, (v) => {
  if (v) clampPosition(props.position.x, props.position.y)
})

const popupStyle = computed(() => ({
  left: `${popupX.value}px`,
  top: `${popupY.value}px`,
  transform: 'none',
}))

function startDrag(e: MouseEvent) {
  dragging = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  startLeft = popupX.value
  startTop = popupY.value
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
}

function onDrag(e: MouseEvent) {
  if (!dragging) return
  const dx = e.clientX - dragStartX
  const dy = e.clientY - dragStartY
  clampPosition(startLeft + dx + 160, startTop + dy - 20)
}

function stopDrag() {
  dragging = false
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
  if (playTimer) clearTimeout(playTimer)
})

// 发音
function pronounce() {
  if (isPlaying.value) return
  isPlaying.value = true
  emit('pronounce', props.detail.word)
  // 2.5 秒后恢复
  playTimer = setTimeout(() => { isPlaying.value = false }, 2500)
}

function close() { emit('close') }
</script>

<style scoped>
.word-popup-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
}

.word-popup {
  position: fixed;
  z-index: 2001;
  width: 320px;
  max-width: calc(100vw - 32px);
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 20px;
  box-shadow: 0 12px 50px rgba(0, 0, 0, 0.18), 0 2px 12px rgba(0, 0, 0, 0.08);
}

.wp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  cursor: grab;
  user-select: none;
}

.wp-header:active { cursor: grabbing; }

.wp-word {
  font-size: 1.4em;
  font-weight: 700;
  color: #1e293b;
}

.wp-close {
  width: 28px; height: 28px;
  border: none; border-radius: 50%;
  background: #f1f5f9; font-size: 18px; color: #64748b;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.wp-close:hover { background: #fee2e2; color: #ef4444; }

.wp-phonetic {
  display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
}
.wp-phonetic-text {
  font-family: 'Georgia', serif; color: #6366f1; font-size: 1.05em;
}
.wp-pronounce {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 10px; border: 1px solid #e2e8f0; border-radius: 14px;
  background: #f8fafc; color: #6366f1; font-size: 12px;
  cursor: pointer; transition: all 0.15s;
}
.wp-pronounce:hover { background: #eef2ff; border-color: #c7d2fe; }
.wp-pronounce.playing {
  background: #eef2ff; border-color: #a5b4fc;
}

/* 播放动画条 */
.playing-bars {
  display: flex; align-items: flex-end; gap: 2px; height: 14px;
}
.playing-bars span {
  width: 3px; background: #6366f1; border-radius: 1px;
  animation: barAnim 0.8s infinite ease-in-out alternate;
}
.playing-bars span:nth-child(1) { height: 8px; animation-delay: 0s; }
.playing-bars span:nth-child(2) { height: 14px; animation-delay: 0.15s; }
.playing-bars span:nth-child(3) { height: 10px; animation-delay: 0.3s; }

@keyframes barAnim {
  from { transform: scaleY(0.5); opacity: 0.4; }
  to { transform: scaleY(1); opacity: 1; }
}

.wp-definition { color: #334155; line-height: 1.6; margin-bottom: 10px; }
.wp-example {
  background: #f8fafc; border-radius: 8px; padding: 10px 14px;
  color: #64748b; font-size: 0.95em; line-height: 1.5;
}
.wp-example-label {
  font-weight: 600; color: #94a3b8; font-size: 0.85em;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.wp-loading { display: flex; align-items: center; gap: 8px; padding: 10px 0; color: #64748b; font-size: 0.9em; }
.spinner-sm {
  width: 16px; height: 16px; border: 2px solid #e2e8f0;
  border-top-color: #6366f1; border-radius: 50%; animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.popup-fade-enter-active, .popup-fade-leave-active { transition: opacity 0.15s ease; }
.popup-fade-enter-from, .popup-fade-leave-to { opacity: 0; }
</style>
