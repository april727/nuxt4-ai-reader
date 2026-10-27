<template>
  <div
    ref="vp"
    class="sheet-vp"
    :class="{ 'is-box': tool === 'box', 'is-panning': drag?.mode === 'pan' }"
    @wheel.prevent="onWheel"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @dblclick="fitWidth"
  >
    <div v-if="!page" class="sheet-blank">没有页面</div>

    <div v-else class="sheet-stage" :style="stageStyle">
      <img
        :src="page.url"
        class="sheet-img"
        alt=""
        draggable="false"
        decoding="async"
        fetchpriority="high"
        @load="onImgLoad"
        @dragstart.prevent
      />

      <div
        v-for="item in pageAnnos"
        :key="item.a.id"
        class="sheet-anno"
        :class="[`k-${item.a.kind}`, { active: item.a.id === selectedId }]"
        :style="boxStyle(item.a.bbox)"
        @pointerdown.stop
        @click.stop="emit('select', item.a.id)"
      >
        <span class="anno-num" :style="numStyle">{{ item.i + 1 }}</span>
      </div>

      <div v-if="draft" class="sheet-anno draft" :style="boxStyle(draft)"></div>
    </div>

    <div class="sheet-zoombar">
      <button title="缩小" @click="zoomBy(1 / 1.25)">−</button>
      <button class="zoom-val" title="回到适配整页" @click="fitAll">{{ Math.round(totalScale * 100) }}%</button>
      <button title="放大" @click="zoomBy(1.25)">+</button>
    </div>

    <div class="sheet-hint">
      {{ tool === 'box' ? '按住拖动框选题目' : '拖动平移 · 滚轮上下 · 双击适配宽度' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import type { SheetPage, SheetAnno, SheetBBox } from '~/utils/sheetTypes'

const props = defineProps<{
  page: SheetPage | null
  annotations: SheetAnno[]
  tool: 'pan' | 'box'
  selectedId?: string
}>()

const emit = defineEmits<{
  (e: 'create', bbox: SheetBBox): void
  (e: 'select', id: string): void
  (e: 'ready'): void
}>()

const vp = ref<HTMLElement | null>(null)
const imgW = ref(0)
const imgH = ref(0)
const fitScale = ref(1)
const zoom = ref(1)
const tx = ref(0)
const ty = ref(0)
const draft = ref<{ x: number; y: number; w: number; h: number } | null>(null)

const totalScale = computed(() => fitScale.value * zoom.value)

/** 编号按「页内顺序」：第 2 页的第 1 个框显示 1，而不是沿用全局序号 */
const pageAnnos = computed(() => {
  if (!props.page) return []
  return props.annotations
    .filter(a => a.pageId === props.page!.id)
    .map((a, i) => ({ a, i }))
})

const stageStyle = computed(() => ({
  width: imgW.value ? `${imgW.value}px` : '100%',
  height: imgH.value ? `${imgH.value}px` : '100%',
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${totalScale.value})`,
}))

/** 线宽与字号要按缩放反向补偿，否则放大后框会粗到盖住题干 */
function boxStyle(b: { x: number; y: number; w: number; h: number }) {
  const s = totalScale.value || 1
  return {
    left: `${b.x * 100}%`,
    top: `${b.y * 100}%`,
    width: `${b.w * 100}%`,
    height: `${b.h * 100}%`,
    borderWidth: `${Math.min(3, 1.6 / s)}px`,
  }
}

const numStyle = computed(() => {
  const s = totalScale.value || 1
  return {
    fontSize: `${Math.min(20, 10 / s)}px`,
    padding: `${3 / s}px ${5 / s}px`,
  }
})

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

function onImgLoad(e: Event) {
  const img = e.target as HTMLImageElement
  imgW.value = img.naturalWidth || props.page?.w || 0
  imgH.value = img.naturalHeight || props.page?.h || 0
  void nextTick(() => {
    fitWidth()
    emit('ready')
  })
}

/** 把某个标注框移到视口中央（从右侧列表「定位到原图」时调用） */
function focusOn(b: SheetBBox) {
  const el = vp.value
  if (!el || !imgW.value || !imgH.value) return
  const cw = el.clientWidth
  const ch = el.clientHeight
  // 目标：框占视口 72% 宽 / 55% 高，取更小的那个比例，保证整框可见
  const sw = (cw * 0.72) / Math.max(b.w * imgW.value, 1)
  const sh = (ch * 0.55) / Math.max(b.h * imgH.value, 1)
  const s = clamp(Math.min(sw, sh), fitScale.value * 0.3, fitScale.value * 12)
  zoom.value = s / fitScale.value
  tx.value = cw / 2 - (b.x + b.w / 2) * imgW.value * s
  ty.value = ch / 2 - (b.y + b.h / 2) * imgH.value * s
  clampPan()
}

/** 适配整页：先看全局布局，用来判断哪块值得框 */
function fitAll() {
  const el = vp.value
  if (!el || !imgW.value || !imgH.value) return
  const cw = el.clientWidth
  const ch = el.clientHeight
  const s = Math.min((cw - 16) / imgW.value, (ch - 16) / imgH.value)
  fitScale.value = s > 0 ? s : 1
  zoom.value = 1
  tx.value = (cw - imgW.value * s) / 2
  ty.value = Math.max(0, (ch - imgH.value * s) / 2)
}

/** 适配宽度：默认视图，题干文字可直接读，纵向靠拖动/滚轮 */
function fitWidth() {
  const el = vp.value
  if (!el || !imgW.value) return
  const cw = el.clientWidth
  const s = cw / imgW.value
  fitScale.value = s > 0 ? s : 1
  zoom.value = 1
  tx.value = 0
  ty.value = 0
}

function applyScaleAt(nextScale: number, clientX: number, clientY: number) {
  const el = vp.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const sx = clientX - r.left
  const sy = clientY - r.top
  const s0 = totalScale.value
  if (s0 <= 0) return
  tx.value = sx - (sx - tx.value) * (nextScale / s0)
  ty.value = sy - (sy - ty.value) * (nextScale / s0)
  zoom.value = nextScale / fitScale.value
  clampPan()
}

function zoomBy(k: number) {
  const el = vp.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const lo = fitScale.value * 0.3
  const hi = fitScale.value * 12
  applyScaleAt(clamp(totalScale.value * k, lo, hi), r.left + r.width / 2, r.top + r.height / 2)
}

/** 平移越界时拉回，避免图片被拖到视野外找不回来 */
function clampPan() {
  const el = vp.value
  if (!el) return
  const cw = el.clientWidth
  const ch = el.clientHeight
  const w = imgW.value * totalScale.value
  const h = imgH.value * totalScale.value
  tx.value = w <= cw ? (cw - w) / 2 : clamp(tx.value, cw - w, 0)
  ty.value = h <= ch ? (ch - h) / 2 : clamp(ty.value, ch - h, 0)
}

function onWheel(e: WheelEvent) {
  // Ctrl/⌘ + 滚轮（触控板双指捏合）→ 缩放；普通滚轮 → 上下平移
  if (e.ctrlKey || e.metaKey) {
    const s0 = totalScale.value
    const k = Math.exp(-e.deltaY * 0.002)
    const next = clamp(s0 * k, fitScale.value * 0.3, fitScale.value * 12)
    applyScaleAt(next, e.clientX, e.clientY)
    return
  }
  const el = vp.value
  if (!el) return
  if (e.shiftKey) {
    tx.value -= e.deltaY
  } else {
    ty.value -= e.deltaY
    if (e.deltaX) tx.value -= e.deltaX
  }
  clampPan()
}

// ── 指针：单指拖动（平移或框选），双指捏合缩放 ──
const pointers = new Map<number, { x: number; y: number }>()
let pinch: { dist: number; scale: number; cx: number; cy: number } | null = null
const drag = ref<{ mode: 'pan' | 'box'; sx: number; sy: number; ox: number; oy: number } | null>(null)

function toImg(clientX: number, clientY: number) {
  const el = vp.value!
  const r = el.getBoundingClientRect()
  const s = totalScale.value || 1
  return {
    x: (clientX - r.left - tx.value) / s / (imgW.value || 1),
    y: (clientY - r.top - ty.value) / s / (imgH.value || 1),
  }
}

function onDown(e: PointerEvent) {
  const el = vp.value
  if (!el || !props.page) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  try { (e.target as HTMLElement).setPointerCapture(e.pointerId) } catch {}

  if (pointers.size === 2) {
    const pts = [...pointers.values()]
    pinch = {
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      scale: totalScale.value,
      cx: (pts[0].x + pts[1].x) / 2,
      cy: (pts[0].y + pts[1].y) / 2,
    }
    drag.value = null
    draft.value = null
    return
  }
  if (pointers.size > 2) return

  const r = el.getBoundingClientRect()
  if (props.tool === 'box' && e.button === 0) {
    const p = toImg(e.clientX, e.clientY)
    const x = clamp(p.x, 0, 1)
    const y = clamp(p.y, 0, 1)
    draft.value = { x, y, w: 0, h: 0 }
    drag.value = { mode: 'box', sx: x, sy: y, ox: 0, oy: 0 }
  } else {
    drag.value = {
      mode: 'pan',
      sx: e.clientX - r.left,
      sy: e.clientY - r.top,
      ox: tx.value,
      oy: ty.value,
    }
  }
}

function onMove(e: PointerEvent) {
  if (!pointers.has(e.pointerId)) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

  if (pointers.size === 2 && pinch) {
    const pts = [...pointers.values()]
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
    if (!pinch.dist) return
    const next = clamp(pinch.scale * (dist / pinch.dist), fitScale.value * 0.3, fitScale.value * 12)
    applyScaleAt(next, pinch.cx, pinch.cy)
    return
  }

  const d = drag.value
  if (!d) return
  const el = vp.value!
  const r = el.getBoundingClientRect()

  if (d.mode === 'pan') {
    tx.value = d.ox + (e.clientX - r.left - d.sx)
    ty.value = d.oy + (e.clientY - r.top - d.sy)
    clampPan()
    return
  }

  const p = toImg(e.clientX, e.clientY)
  const x0 = clamp(Math.min(d.sx, p.x), 0, 1)
  const x1 = clamp(Math.max(d.sx, p.x), 0, 1)
  const y0 = clamp(Math.min(d.sy, p.y), 0, 1)
  const y1 = clamp(Math.max(d.sy, p.y), 0, 1)
  draft.value = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function onUp(e: PointerEvent) {
  pointers.delete(e.pointerId)
  if (pointers.size < 2) pinch = null
  const d = drag.value
  drag.value = null
  if (d?.mode !== 'box') return

  const b = draft.value
  draft.value = null
  // 小于 0.4% 的框视为误触（点一下会留下噪点标注）
  if (b && b.w > 0.004 && b.h > 0.004) emit('create', b)
}

defineExpose({ fitAll, fitWidth, focusOn })
</script>

<style scoped>
.sheet-vp {
  position: relative;
  flex: 1;
  overflow: hidden;
  background: #e9e7e1;
  touch-action: none;
  user-select: none;
  cursor: grab;
}
.sheet-vp.is-panning { cursor: grabbing; }
.sheet-vp.is-box { cursor: crosshair; }
.sheet-blank {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: #a09e97; font-size: 13px;
}
.sheet-stage {
  position: absolute; top: 0; left: 0;
  transform-origin: 0 0;
  will-change: transform;
}
.sheet-img {
  display: block; width: 100%; height: 100%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}
.sheet-anno {
  position: absolute;
  box-sizing: border-box;
  border-style: solid;
  border-color: #3d3591;
  background: rgba(61, 53, 145, 0.06);
  border-radius: 3px;
  cursor: pointer;
}
.sheet-anno.k-wrong { border-color: #a32d2d; background: rgba(163, 45, 45, 0.08); }
.sheet-anno.k-key { border-color: #ba7517; background: rgba(186, 117, 23, 0.09); }
.sheet-anno.k-doubt { border-color: #378add; background: rgba(55, 138, 221, 0.08); }
.sheet-anno.k-note { border-color: #0f6e56; background: rgba(15, 110, 86, 0.08); }
.sheet-anno.active { box-shadow: 0 0 0 2px rgba(61, 53, 145, 0.35); }
.sheet-anno.draft {
  border-style: dashed;
  border-color: #3d3591;
  background: rgba(61, 53, 145, 0.1);
  pointer-events: none;
}
.anno-num {
  position: absolute; top: 0; left: 0;
  transform: translate(-100%, -100%);
  background: #3d3591; color: #fff;
  border-radius: 3px 3px 3px 0;
  font-family: 'DM Mono', monospace;
  line-height: 1;
}
.k-wrong .anno-num { background: #a32d2d; }
.k-key .anno-num { background: #ba7517; }
.k-doubt .anno-num { background: #378add; }
.k-note .anno-num { background: #0f6e56; }

.sheet-zoombar {
  position: absolute; right: 14px; bottom: 14px;
  display: flex; align-items: center; gap: 2px;
  background: rgba(255, 255, 255, 0.94);
  border: 0.5px solid rgba(0, 0, 0, 0.12);
  border-radius: 9px; padding: 3px;
  backdrop-filter: blur(6px);
}
.sheet-zoombar button {
  border: none; background: transparent; cursor: pointer;
  font-family: 'DM Sans', sans-serif; font-size: 13px; color: #4a4843;
  min-width: 26px; height: 24px; border-radius: 6px; padding: 0 4px;
}
.sheet-zoombar button:hover { background: #f2f0ec; }
.zoom-val { font-variant-numeric: tabular-nums; font-size: 11.5px !important; color: #8a8880 !important; min-width: 42px !important; }

.sheet-hint {
  position: absolute; left: 14px; bottom: 16px;
  font-size: 11.5px; color: #8a8880;
  background: rgba(255, 255, 255, 0.86);
  border-radius: 7px; padding: 4px 9px;
  pointer-events: none;
}
</style>
