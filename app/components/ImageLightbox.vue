<template>
  <Teleport to="body">
    <Transition name="lb">
      <div v-if="open" class="lb" @click.self="close">
        <div class="lb-stage">
          <img
            :src="current" class="lb-img"
            :class="{ 'lb-img--actual': zoom > 1 }"
            :style="{ transform: `scale(${zoom})` }"
            draggable="false" @click.stop
            @dblclick="toggleZoom"
          >
        </div>

        <button v-if="list.length > 1" class="lb-nav lb-nav--prev" @click.stop="step(-1)" title="上一张 (←)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <button v-if="list.length > 1" class="lb-nav lb-nav--next" @click.stop="step(1)" title="下一张 (→)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><polyline points="9 18 15 12 9 6"/></svg>
        </button>

        <div class="lb-hud" @click.stop>
          <span v-if="list.length > 1" class="lb-count">{{ index + 1 }} / {{ list.length }}</span>
          <button class="lb-btn" @click.stop="zoomOut" title="缩小 (-)">−</button>
          <button class="lb-btn" @click.stop="zoomIn" title="放大 (+)">+</button>
          <button class="lb-btn" @click.stop="zoom = 1" title="实际大小/适应屏幕">1:1</button>
          <button class="lb-btn lb-btn--close" @click.stop="close" title="关闭 (Esc)">×</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 阅读器图片灯箱：遮罩 + 全幅 + 左右切换 + 缩放。
 *
 * 为什么不复用 FloatingImage：那是可拖动的浮动小卡，用来"边读边比对"，
 * 尺寸被刻意限制在 480px。看配图细节要的是占满视口、无干扰、能左右翻。
 */
const props = defineProps<{ open: boolean; list: string[]; index: number }>()
const emit = defineEmits<{ close: []; 'update:index': [number] }>()

const zoom = ref(1)

function srcOf(img: string) {
  if (!img) return ''
  if (/^(https?:)?\/\//.test(img) || img.startsWith('/') || img.startsWith('blob:') || img.startsWith('data:')) return img
  return `/api/file/${img}`
}
/** 列表里的 key 转成可访问地址（历史数据里有 key 也有完整 URL） */
const urls = computed(() => props.list.map(srcOf))
const current = computed(() => urls.value[props.index] || '')
watch(() => props.index, () => { zoom.value = 1 })
watch(() => props.open, (v) => { if (v) zoom.value = 1 })

function close() { emit('close') }
function step(d: number) {
  if (props.list.length < 2) return
  const n = (props.index + d + props.list.length) % props.list.length
  emit('update:index', n)
}
function zoomIn() { zoom.value = Math.min(4, +(zoom.value + 0.25).toFixed(2)) }
function zoomOut() { zoom.value = Math.max(1, +(zoom.value - 0.25).toFixed(2)) }
function toggleZoom() { zoom.value = zoom.value > 1 ? 1 : 2 }

function onKey(e: KeyboardEvent) {
  if (!props.open) return
  if (e.key === 'Escape') { e.preventDefault(); close() }
  if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) }
  if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
  if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn() }
  if (e.key === '-') { e.preventDefault(); zoomOut() }
}

// 触屏滑动切换
let touchX = 0
function onTouchStart(e: TouchEvent) { touchX = e.touches[0].clientX }
function onTouchEnd(e: TouchEvent) {
  const dx = e.changedTouches[0].clientX - touchX
  if (Math.abs(dx) > 60) step(dx > 0 ? -1 : 1)
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchend', onTouchEnd, { passive: true })
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('touchstart', onTouchStart)
  window.removeEventListener('touchend', onTouchEnd)
})
</script>

<style scoped>
.lb {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: rgba(12, 12, 16, 0.93);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4vh 4vw;
  backdrop-filter: blur(6px);
}

.lb-stage {
  max-width: 100%;
  max-height: 100%;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lb-img {
  max-width: min(92vw, 1400px);
  max-height: 92vh;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
  transition: transform 0.16s ease;
  cursor: zoom-in;
  user-select: none;
}
.lb-img--actual { cursor: zoom-out; max-width: none; max-height: none; }

.lb-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 42px;
  height: 64px;
  border: none;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.8);
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.lb-nav:hover { background: rgba(255, 255, 255, 0.16); color: #fff; }
.lb-nav--prev { left: 12px; }
.lb-nav--next { right: 12px; }

.lb-hud {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.09);
  backdrop-filter: blur(10px);
}
.lb-count {
  color: rgba(255, 255, 255, 0.72);
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 11.5px;
  padding: 0 8px;
  letter-spacing: 0.06em;
}
.lb-btn {
  min-width: 30px;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: rgba(255, 255, 255, 0.82);
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.14s, color 0.14s;
}
.lb-btn:hover { background: rgba(255, 255, 255, 0.16); color: #fff; }
.lb-btn--close { font-size: 17px; }
.lb-btn--close:hover { background: rgba(220, 38, 38, 0.75); }

.lb-enter-active, .lb-leave-active { transition: opacity 0.18s ease; }
.lb-enter-from, .lb-leave-to { opacity: 0; }

@media (max-width: 760px) {
  .lb { padding: 2vh 2vw; }
  .lb-nav { width: 34px; height: 52px; }
  .lb-nav--prev { left: 4px; }
  .lb-nav--next { right: 4px; }
  .lb-img { max-width: 96vw; max-height: 80vh; }
}
</style>
