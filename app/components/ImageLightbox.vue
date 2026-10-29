<template>
  <Teleport to="body">
    <Transition name="lb">
      <div v-if="open" class="lb">
        <div class="lb-stick" :style="stickStyle">
          <img
            ref="imgEl"
            class="lb-img"
            :class="{ 'is-grabbing': dragging }"
            :src="url" :style="imgStyle"
            alt="" draggable="false"
            @wheel.prevent.stop="onWheel"
            @pointerdown.stop.prevent="onDown"
            @pointermove.stop="onMove"
            @pointerup.stop="onUp"
            @pointercancel="onUp"
            @dblclick.stop="close"
            @contextmenu.prevent
          >

          <Transition name="lb-tip">
            <div v-if="showHint" class="lb-tip">滚轮缩放 · 拖动移动 · 双击或 Esc 关闭</div>
          </Transition>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 配图「贴图」浮层 —— 不是灯箱。
 *
 * 和常见灯箱的区别（也是上一版被否掉的地方）：
 * - **没有黑色遮罩**：`pointer-events: none` + 全透明，页面照常可读可点，
 *   图就像截图工具的贴图一样浮在文字上。
 * - **没有翻页**：一次只贴一张，看完关掉，不做 1/2/3 轮播。
 * - **没有底部工具栏**：缩放/拖动全靠手势，关闭靠双击或 Esc，不留常驻控件。
 * - **任何倍率都能拖**：贴图的意义就是把图挪到想对照的段落旁边，
 *   旧版只有放大后才允许拖动。
 *
 * 缩放实现要点（改之前先读）：
 * 1. **以光标为锚点**：保持光标下的像素不动，否则一边放大一边追着拖。
 * 2. **用 transform 不改宽高**：改尺寸会重排、每滚一格都抖；transform 走合成层。
 *    代价是布局盒不跟着变，平移范围要自己 clamp，否则能把图拖出屏幕找不回来。
 */
const props = defineProps<{ open: boolean; src: string }>()
const emit = defineEmits<{ close: [] }>()

const MIN_ZOOM = 0.25
const MAX_ZOOM = 8
/** 图至少要有这么多像素留在屏幕内，保证永远拖得回来 */
const KEEP_PX = 80

const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const dragging = ref(false)
const imgEl = ref<HTMLImageElement | null>(null)

/** 兼容历史数据：可能是 key，也可能是完整 URL */
const url = computed(() => {
  let s = props.src || ''
  if (!s) return ''
  // 贴图的唯一用途就是看细节，所以一律取原图：
  // 段落里缩略图带 ?w=1600 之类的派生档位，放大到 2 倍就糊了
  if (s.startsWith('/api/file/')) {
    s = s.replace(/([?&])w=\d+&?/, '$1').replace(/[?&]$/, '')
  }
  if (/^(https?:)?\/\//.test(s) || s.startsWith('/') || s.startsWith('blob:') || s.startsWith('data:')) return s
  return `/api/file/${s}`
})

const stickStyle = computed(() => ({
  transform: `translate(-50%, -50%) translate3d(${panX.value}px, ${panY.value}px, 0)`,
  transition: dragging.value ? 'none' : 'transform 0.16s cubic-bezier(.22,.61,.36,1)',
}))

const imgStyle = computed(() => ({
  transform: `scale(${zoom.value})`,
  transition: dragging.value ? 'transform 0.05s linear' : 'transform 0.16s cubic-bezier(.22,.61,.36,1)',
}))

const showHint = ref(false)
let hintTimer: ReturnType<typeof setTimeout> | null = null

function reset() {
  zoom.value = 1
  panX.value = 0
  panY.value = 0
}

watch(() => props.src, reset)
watch(() => props.open, (v) => {
  if (!v) return
  reset()
  showHint.value = true
  if (hintTimer) clearTimeout(hintTimer)
  hintTimer = setTimeout(() => { showHint.value = false }, 2800)
})

function clampZoom(z: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +z.toFixed(3)))
}

/** 平移上限：图中心离屏幕中心最远只能到「半个图 + 半个屏 - 保留量」 */
function clampPan() {
  const img = imgEl.value
  if (!img) return
  const w = (img.offsetWidth || 0) * zoom.value
  const h = (img.offsetHeight || 0) * zoom.value
  const mx = Math.max(0, (window.innerWidth + w) / 2 - KEEP_PX)
  const my = Math.max(0, (window.innerHeight + h) / 2 - KEEP_PX)
  panX.value = Math.min(mx, Math.max(-mx, panX.value))
  panY.value = Math.min(my, Math.max(-my, panY.value))
}

/**
 * 缩放到 next，并保持光标处那个像素不动。
 * 设光标相对屏幕中心为 o，图内未缩放坐标 p = (o - pan) / zoom，
 * 要求 p * next + pan' = o  =>  pan' = o - (o - pan) * next / zoom
 */
function zoomTo(next: number, clientX?: number, clientY?: number) {
  const to = clampZoom(next)
  const from = zoom.value
  if (to === from) return
  const ox = (clientX ?? window.innerWidth / 2) - window.innerWidth / 2
  const oy = (clientY ?? window.innerHeight / 2) - window.innerHeight / 2
  const k = to / from
  panX.value = ox - (ox - panX.value) * k
  panY.value = oy - (oy - panY.value) * k
  zoom.value = to
  clampPan()
}

function onWheel(e: WheelEvent) {
  // 触控板的横向滚动不算缩放；其余按指数缩放，手感线性
  if (e.deltaY === 0) return
  const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.008 : 0.0018))
  zoomTo(zoom.value * factor, e.clientX, e.clientY)
}

// ── 指针：单指拖动 / 双指缩放（指针事件同时覆盖鼠标、触屏、触控笔）──
const pointers = new Map<number, { x: number; y: number }>()
let dragStart: { x: number; y: number; panX: number; panY: number } | null = null
let pinch: { dist: number; zoom: number } | null = null

function dist2() {
  const [a, b] = [...pointers.values()]
  return Math.hypot(a.x - b.x, a.y - b.y)
}
function mid2() {
  const [a, b] = [...pointers.values()]
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function onDown(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 2) {
    pinch = { dist: dist2(), zoom: zoom.value }
    dragStart = null
    dragging.value = false
    return
  }
  if (pointers.size === 1) {
    dragStart = { x: e.clientX, y: e.clientY, panX: panX.value, panY: panY.value }
    dragging.value = true
  }
}

function onMove(e: PointerEvent) {
  if (!pointers.has(e.pointerId)) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 2 && pinch) {
    const m = mid2()
    zoomTo(pinch.zoom * (dist2() / (pinch.dist || 1)), m.x, m.y)
    return
  }
  if (dragStart) {
    panX.value = dragStart.panX + (e.clientX - dragStart.x)
    panY.value = dragStart.panY + (e.clientY - dragStart.y)
    clampPan()
  }
}

function onUp(e: PointerEvent) {
  pointers.delete(e.pointerId)
  if (pointers.size < 2) pinch = null
  if (pointers.size === 0) {
    dragStart = null
    dragging.value = false
  }
}

function close() { emit('close') }

function onKey(e: KeyboardEvent) {
  if (!props.open) return
  if (e.key === 'Escape') { e.preventDefault(); close() }
  if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(zoom.value + 0.25) }
  if (e.key === '-') { e.preventDefault(); zoomTo(zoom.value - 0.25) }
  if (e.key === '0') { e.preventDefault(); reset() }
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => {
  if (hintTimer) clearTimeout(hintTimer)
  window.removeEventListener('keydown', onKey)
})
</script>

<style scoped>
/* 全透明、不吃点击：页面照常可读可点，这正是「贴图」而不是「灯箱」的关键 */
.lb {
  position: fixed;
  inset: 0;
  z-index: 4000;
  pointer-events: none;
}

.lb-stick {
  position: fixed;
  left: 50%;
  top: 50%;
  will-change: transform;
}

.lb-img {
  display: block;
  width: auto;
  height: auto;
  max-width: min(84vw, 1180px);
  max-height: 80vh;
  pointer-events: auto;
  transform-origin: 50% 50%;
  will-change: transform;
  border-radius: 3px;
  /* 只给一圈发丝线和柔和投影，让图从纸面"浮"起来；不给任何背景色边框 */
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08), 0 22px 60px -14px rgba(0, 0, 0, 0.42);
  cursor: grab;
  user-select: none;
  -webkit-user-drag: none;
  touch-action: none;
}
.lb-img.is-grabbing { cursor: grabbing; }

/* 操作提示：贴在图片上沿外侧，出现 2.8s 后消失，不是常驻工具栏。
   不能用 fixed 到视口顶部 —— 那里常压着站点头部按钮，看着像多出来一条 UI。 */
.lb-tip {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  padding: 5px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(0, 0, 0, 0.07);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.09);
  backdrop-filter: blur(8px);
  color: #57554e;
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 11.5px;
  letter-spacing: 0.02em;
  white-space: nowrap;
  pointer-events: none;
}

.lb-enter-active, .lb-leave-active { transition: opacity 0.16s ease; }
.lb-enter-from, .lb-leave-to { opacity: 0; }
.lb-enter-active .lb-img { transition: transform 0.18s cubic-bezier(.22,.61,.36,1); }

.lb-tip-enter-active, .lb-tip-leave-active { transition: opacity 0.3s ease; }
.lb-tip-enter-from, .lb-tip-leave-to { opacity: 0; }

@media (max-width: 760px) {
  .lb-img { max-width: 88vw; max-height: 74vh; }
  /* 手机上别藏提示：没有工具栏时这是唯一告诉用户"双击可以关"的地方 */
  .lb-tip { font-size: 10.5px; padding: 4px 9px; }
}
</style>
