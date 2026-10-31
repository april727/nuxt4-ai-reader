<template>
  <div
    ref="vp"
    class="sheet-vp"
    :class="{ 'is-box': tool === 'box', 'is-cover': tool === 'cover', 'is-panning': drag?.mode === 'pan' }"
    @wheel.prevent="onWheel"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @dblclick="onDblClick"
  >
    <div v-if="!board.pages.length" class="sheet-blank">没有页面</div>

    <div v-else class="sheet-board" :style="boardStyle">
      <div
        v-for="(p, pi) in board.pages"
        :key="p.id"
        class="sheet-page"
        :class="{ current: p.id === activePageId }"
        :style="pageStyle(p)"
      >
        <!-- 兜底占位：图片未到时也有纸面底色，不会在画布上出现空洞 -->
        <img
          :src="resolved[p.id] || p.url"
          class="sheet-img"
          :data-tier="tierOf[p.id] || 'orig'"
          alt=""
          draggable="false"
          decoding="async"
          :fetchpriority="p.id === activePageId ? 'high' : 'low'"
          @dragstart.prevent
        />

        <!-- 答案遮挡：盖在最上层压住题面里的答案，点一下临时显形 3 秒 -->
        <div
          v-for="(c, ci) in coversOf(p)"
          :key="`cv_${p.id}_${ci}`"
          class="sheet-cover"
          :class="{ peeking: peekKey === `${p.id}:${ci}` }"
          :style="boxStyle(c)"
          :title="peekKey === `${p.id}:${ci}` ? '再点一次可继续观察' : '点击临时显示答案'"
          @pointerdown.stop
          @click.stop="togglePeek(p.id, ci)"
        >
          <span class="cover-tag" :style="numStyle">{{ peekKey === `${p.id}:${ci}` ? '答案' : `遮 ${ci + 1}` }}</span>
        </div>

        <div
          v-for="item in annosOf(p.id)"
          :key="item.a.id"
          class="sheet-anno"
          :class="[`k-${item.a.kind}`, { active: item.a.id === selectedId }]"
          :style="boxStyle(item.a.bbox)"
          @pointerdown.stop
          @click.stop="emit('select', item.a.id)"
        >
          <span class="anno-num" :style="numStyle">{{ item.i + 1 }}</span>
        </div>

        <div
          v-if="draft && draft.pageId === p.id"
          class="sheet-anno draft"
          :class="{ 'draft-cover': drag?.mode === 'cover' }"
          :style="boxStyle(draft.bbox)"
        ></div>

        <!-- 页码水印：缩到很小时每页只剩一块白，没有这个数字就分不清第几页。
             放大阅读时它反而挡字，按缩放淡出 -->
        <span v-if="p.bw * scale < vpW * 0.75" class="page-no" :style="{ fontSize: `${Math.min(600, 12 / scale)}px` }">{{ pi + 1 }}</span>
      </div>
    </div>

    <div class="sheet-zoombar">
      <button title="缩小" @click="zoomBy(1 / 1.25)">−</button>
      <button class="zoom-val" :title="`当前 ${Math.round(scale * 100)}%，点击看全部 ${board.pages.length} 页`" @click="fitAll">
        {{ Math.round(scale * 100) }}%
      </button>
      <button title="放大" @click="zoomBy(1.25)">+</button>
    </div>

    <div class="sheet-hint">{{ hintText }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, nextTick, watch, onMounted, onBeforeUnmount } from 'vue'
import type { SheetPage, SheetAnno, SheetBBox } from '~/utils/sheetTypes'

/**
 * 连续画布（取代「一页一张图 + 翻页换图」）。
 *
 * 关键约束：标注与遮挡的坐标是**页内归一化**（0~1），所以多页只是给每页套一个
 * 容器，那两层一行都不用改；真正要动的是「屏幕坐标 → 哪一页 → 页内归一化」这条链。
 *
 * 两个必须自己做的事，浏览器不会代劳：
 * 1. **图片分辨率分档**：画布靠 transform: scale() 缩放，而 srcset 的选择依据是
 *    CSS 布局尺寸 × dpr，完全不感知 transform。不管的话缩到 8% 它照样拉 1600px 原图，
 *    1722×2400×4B ≈ 16.5MB 解码内存/页，10 页就是 165MB。
 * 2. **页归属**：一个框只能挂一页，跨页部分必须裁掉（见 onMove）。
 */

const props = defineProps<{
  pages: SheetPage[]
  activePageId?: string
  annotations: SheetAnno[]
  tool: 'pan' | 'box' | 'cover'
  selectedId?: string
  /** 顶栏「显示答案」开着时不再渲染遮挡块 */
  answersVisible?: boolean
}>()

const emit = defineEmits<{
  (e: 'create', v: { pageId: string; bbox: SheetBBox }): void
  (e: 'create-cover', v: { pageId: string; bbox: SheetBBox }): void
  (e: 'select', id: string): void
  (e: 'active-page', pageId: string): void
  (e: 'ready'): void
}>()

const vp = ref<HTMLElement | null>(null)
const vpW = ref(0)
const vpH = ref(0)

/** 页间留白（画布单位 = 原图像素），按典型页宽给一个不刺眼的值 */
const GAP = 64

// ── 布局：单列竖排，不同宽度的页各自居中 ──
const board = computed(() => {
  const list = props.pages.filter(p => p && p.url && p.w > 0 && p.h > 0)
  const canvasW = list.reduce((m, p) => Math.max(m, p.w), 1)
  let y = 0
  const pages = list.map((p) => {
    const item = { ...p, x: (canvasW - p.w) / 2, y, bw: p.w, bh: p.h }
    y += p.h + GAP
    return item
  })
  return { pages, canvasW, canvasH: Math.max(0, y - GAP) }
})

type BoardPage = { id: string; url: string; w: number; h: number; covers?: SheetBBox[]; x: number; y: number; bw: number; bh: number }

// ── 相机：scale 是「画布单位 → CSS 像素」的绝对倍率，tx/ty 是平移 ──
const scale = ref(1)
const tx = ref(0)
const ty = ref(0)

const fitAllScale = computed(() => {
  const b = board.value
  if (!vpW.value || !vpH.value || !b.canvasW || !b.canvasH) return 1
  return Math.min((vpW.value - 24) / b.canvasW, (vpH.value - 24) / b.canvasH)
})

/** 允许比「全部可见」再小一半，留点余量；上限沿用「页宽铺满」的 12 倍 */
const limits = computed(() => {
  const minS = Math.max(0.01, fitAllScale.value * 0.55)
  const fitW = board.value.pages.length ? Math.max(...board.value.pages.map(p => vpW.value / p.w)) : 1
  return { min: Math.min(minS, fitW), max: Math.max(fitW * 12, minS * 2) }
})

const boardStyle = computed(() => ({
  width: `${board.value.canvasW}px`,
  height: `${board.value.canvasH}px`,
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`,
}))

function pageStyle(p: BoardPage) {
  return {
    left: `${p.x}px`,
    top: `${p.y}px`,
    width: `${p.bw}px`,
    height: `${p.bh}px`,
  }
}

// ── 标注 / 遮挡按页分组 ──
const annosIndexed = computed(() => {
  const m: Record<string, { a: SheetAnno; i: number }[]> = {}
  for (const a of props.annotations) {
    if (!a?.pageId) continue
    ;(m[a.pageId] ||= []).push({ a, i: 0 })
  }
  for (const k of Object.keys(m)) m[k].forEach((it, i) => { it.i = i })
  return m
})
function annosOf(pageId: string) {
  return annosIndexed.value[pageId] || []
}

function coversOf(p: BoardPage): SheetBBox[] {
  if (props.answersVisible) return []
  return Array.isArray(p.covers) ? p.covers : []
}

/**
 * 临时显形：点一下遮罩揭开 3 秒再盖回去。
 * 键带页 id —— 多页同屏时只用下标会点第 2 页的遮罩却掀开第 1 页。
 */
const peekKey = ref<string | null>(null)
let peekTimer: ReturnType<typeof setTimeout> | null = null
function togglePeek(pageId: string, ci: number) {
  const key = `${pageId}:${ci}`
  if (peekTimer) { clearTimeout(peekTimer); peekTimer = null }
  if (peekKey.value === key) { peekKey.value = null; return }
  peekKey.value = key
  peekTimer = setTimeout(() => { peekKey.value = null; peekTimer = null }, 3000)
}
onBeforeUnmount(() => { if (peekTimer) clearTimeout(peekTimer) })

// ── 提示文案 ──
const coarse = ref(false)
const hintText = computed(() => {
  if (props.tool === 'box') return '拖动框选题目'
  if (props.tool === 'cover') return '拖动盖住答案 · 点遮罩看 3 秒'
  return coarse.value
    ? '单指拖动 · 双指缩放'
    : '拖动平移 · 滚轮上下 · 双击聚焦'
})

// ── 线宽与字号按缩放反向补偿，否则放大后框会粗到盖住题干 ──
function boxStyle(b: SheetBBox) {
  const s = scale.value || 1
  return {
    left: `${b.x * 100}%`,
    top: `${b.y * 100}%`,
    width: `${b.w * 100}%`,
    height: `${b.h * 100}%`,
    borderWidth: `${Math.min(3, 1.6 / s)}px`,
  }
}
const numStyle = computed(() => {
  const s = scale.value || 1
  return {
    fontSize: `${Math.min(20, 10 / s)}px`,
    padding: `${3 / s}px ${5 / s}px`,
  }
})

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

// ── 图片分档 ──
/**
 * 目标宽度 → 档位。0 表示用原图。
 *
 * 不在视口里的页固定用低档：放大看第 1 页时，第 8 页没必要也按 300% 拉原图 ——
 * 那才是内存真正失控的地方（每页 16MB 级）。
 */
const TIERS = [320, 480, 640, 800, 1200, 1600, 2000]
const resolved = reactive<Record<string, string>>({})
const tierOf = reactive<Record<string, number | string>>({})
let srcToken = 0

function dpr() {
  return typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
}

function nearViewport(p: BoardPage) {
  const top = p.y * scale.value + ty.value
  const bottom = (p.y + p.bh) * scale.value + ty.value
  const pad = vpH.value * 1.2
  return bottom > -pad && top < vpH.value + pad
}

function targetFor(p: BoardPage) {
  const need = nearViewport(p) ? Math.ceil(p.bw * scale.value * dpr()) : 420
  // 接近原尺寸就不派生：服务端虽然不会放大，但转码一份只为了 8% 的差距不值
  if (need >= p.bw * 0.9) return { src: p.url, tier: 0 }
  // 向上吸附（宁可略大不要糊）：试卷是密排小字，向下取一档在 dpr=2 下会明显发虚
  const tier = TIERS.find(t => t >= need) || TIERS[TIERS.length - 1]
  return { src: `${p.url}?w=${tier}`, tier }
}

/**
 * 换档要「先预载、再替换」，否则每次缩放都会闪一帧空白。
 * token 防乱序：快速缩放会并发多次，晚到的旧结果不能盖掉新的。
 */
function refreshSrcs() {
  const token = ++srcToken
  for (const p of board.value.pages) {
    const { src, tier } = targetFor(p)
    if (resolved[p.id] === src) { tierOf[p.id] = tier || 'orig'; continue }
    const pre = new Image()
    pre.decoding = 'async'
    pre.onload = () => {
      if (token !== srcToken) return
      resolved[p.id] = src
      tierOf[p.id] = tier || 'orig'
    }
    pre.onerror = () => {
      if (token !== srcToken) return
      // 派生失败就退回原图（缩略图是优化，不能变成单点故障）
      resolved[p.id] = p.url
      tierOf[p.id] = 'orig'
    }
    pre.src = src
  }
}

let srcTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSrcs() {
  if (srcTimer) clearTimeout(srcTimer)
  srcTimer = setTimeout(() => { srcTimer = null; refreshSrcs() }, 140)
}

// ── 缩放 / 平移 ──
function clampPan() {
  const bw = board.value.canvasW * scale.value
  const bh = board.value.canvasH * scale.value
  const cw = vpW.value
  const ch = vpH.value
  tx.value = bw <= cw ? (cw - bw) / 2 : clamp(tx.value, cw - bw, 0)
  ty.value = bh <= ch ? (ch - bh) / 2 : clamp(ty.value, ch - bh, 0)
}

function applyScaleAt(nextScale: number, clientX: number, clientY: number) {
  const el = vp.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const sx = clientX - r.left
  const sy = clientY - r.top
  const s0 = scale.value
  if (s0 <= 0) return
  const next = clamp(nextScale, limits.value.min, limits.value.max)
  tx.value = sx - (sx - tx.value) * (next / s0)
  ty.value = sy - (sy - ty.value) * (next / s0)
  scale.value = next
  clampPan()
  scheduleSrcs()
}

function zoomBy(k: number) {
  if (!vp.value) return
  applyScaleAt(scale.value * k, vpW.value / 2, vpH.value / 2)
}

/** 适配整页宽：单页阅读的默认视角 */
function fitPageWidth(pageId?: string, align: 'top' | 'center' = 'top') {
  const p = board.value.pages.find(x => x.id === (pageId ?? props.activePageId)) || board.value.pages[0]
  if (!p || !vpW.value) return
  scale.value = clamp(vpW.value / p.w, limits.value.min, limits.value.max)
  tx.value = (vpW.value - p.w * scale.value) / 2
  ty.value = align === 'top' ? -p.y * scale.value : (vpH.value - p.bh * scale.value) / 2 - p.y * scale.value
  clampPan()
  scheduleSrcs()
}

/** 总览：全部页塞进一屏 */
function fitAll() {
  if (!vpW.value || !vpH.value) return
  scale.value = clamp(fitAllScale.value, limits.value.min, limits.value.max)
  tx.value = (vpW.value - board.value.canvasW * scale.value) / 2
  ty.value = (vpH.value - board.value.canvasH * scale.value) / 2
  clampPan()
  scheduleSrcs()
}

/** 滚到某一页（保持当前缩放）。页比视口高就顶对齐，否则居中 —— 两种情况下视口中心都落在该页内 */
function scrollPageIntoView(pageId: string) {
  const p = board.value.pages.find(x => x.id === pageId)
  if (!p) return
  const ph = p.bh * scale.value
  ty.value = ph > vpH.value
    ? -p.y * scale.value + 8
    : (vpH.value - ph) / 2 - p.y * scale.value
  clampPan()
  scheduleSrcs()
}

/** 把某个框移到视口中央（面板「定位」、深链落点） */
function focusOn(pageId: string, b: SheetBBox) {
  const p = board.value.pages.find(x => x.id === pageId)
  if (!vp.value || !p) return
  const sw = (vpW.value * 0.72) / Math.max(b.w * p.w, 1)
  const sh = (vpH.value * 0.55) / Math.max(b.h * p.h, 1)
  scale.value = clamp(Math.min(sw, sh), limits.value.min, limits.value.max)
  const cx = (p.x + (b.x + b.w / 2) * p.w) * scale.value
  const cy = (p.y + (b.y + b.h / 2) * p.h) * scale.value
  tx.value = vpW.value / 2 - cx
  ty.value = vpH.value / 2 - cy
  clampPan()
  scheduleSrcs()
}

// ── 命中测试 ──
function toBoard(clientX: number, clientY: number) {
  const el = vp.value
  if (!el) return { x: 0, y: 0 }
  const r = el.getBoundingClientRect()
  return {
    x: (clientX - r.left - tx.value) / (scale.value || 1),
    y: (clientY - r.top - ty.value) / (scale.value || 1),
  }
}

function pageAtBoard(x: number, y: number): BoardPage | null {
  for (const p of board.value.pages) {
    if (x >= p.x && x <= p.x + p.bw && y >= p.y && y <= p.y + p.bh) return p
  }
  return null
}

function hitPage(clientX: number, clientY: number) {
  const b = toBoard(clientX, clientY)
  return pageAtBoard(b.x, b.y)
}

/** 视口中心落在哪一页 → 当前页。落在页间隙时取最近的一页 */
function pageAtViewportCenter(): string | null {
  const list = board.value.pages
  if (!list.length) return null
  const cy = (vpH.value / 2 - ty.value) / (scale.value || 1)
  let best: BoardPage | null = null
  let bestD = Infinity
  for (const p of list) {
    if (cy >= p.y && cy <= p.y + p.bh) return p.id
    const d = cy < p.y ? p.y - cy : cy - (p.y + p.bh)
    if (d < bestD) { bestD = d; best = p }
  }
  return best?.id ?? null
}

/**
 * 滚动导致当前页变化 → 通知外部。rAF 合并，拖动时一帧最多一次。
 *
 * `lastEmitId` 是必须的：父组件收到 emit 会回传 activePageId，如果不区分来源，
 * watch 会把"用户滚出来的页"当成"外部命令"，再 scrollPageIntoView 拽回去 ——
 * 表现就是滚动时一跳一跳，永远停不到两页之间。
 */
let syncRaf = 0
let lastEmitId = ''
function syncActivePage() {
  if (syncRaf) return
  syncRaf = requestAnimationFrame(() => {
    syncRaf = 0
    const id = pageAtViewportCenter()
    if (id && id !== props.activePageId) {
      lastEmitId = id
      emit('active-page', id)
    }
  })
}

/** 外部改了当前页（顶栏翻页 / 键盘 / 面板跳转）→ 把视图滚过去 */
watch(() => props.activePageId, (id) => {
  if (!id || !board.value.pages.length) return
  if (id === lastEmitId) { lastEmitId = ''; return }
  const p = board.value.pages.find(x => x.id === id)
  if (!p) return
  // 该页已经完整可见就不动视图（总览态下翻页不该把画面推来推去）
  const top = p.y * scale.value + ty.value
  const bottom = (p.y + p.bh) * scale.value + ty.value
  if (top >= -4 && bottom <= vpH.value + 4) return
  scrollPageIntoView(id)
})

// ── 指针：单指拖动（平移或框选），双指捏合缩放 ──
const pointers = new Map<number, { x: number; y: number }>()
let pinch: { dist: number; scale: number; cx: number; cy: number } | null = null
const drag = ref<{ mode: 'pan' | 'box' | 'cover'; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
const draft = ref<{ pageId: string; bbox: SheetBBox } | null>(null)

function onDown(e: PointerEvent) {
  const el = vp.value
  if (!el || !board.value.pages.length) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  try { (e.target as HTMLElement).setPointerCapture(e.pointerId) } catch {}

  if (pointers.size === 2) {
    const pts = [...pointers.values()]
    pinch = {
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      scale: scale.value,
      cx: (pts[0].x + pts[1].x) / 2,
      cy: (pts[0].y + pts[1].y) / 2,
    }
    drag.value = null
    draft.value = null
    return
  }
  if (pointers.size > 2) return

  const r = el.getBoundingClientRect()
  const drawMode = props.tool === 'box' || props.tool === 'cover' ? props.tool : null
  if (drawMode && e.button === 0) {
    // 框必须属于某一页：起点落在页间隙里就当没点
    const hit = hitPage(e.clientX, e.clientY)
    if (!hit) return
    const b = toBoard(e.clientX, e.clientY)
    const nx = clamp((b.x - hit.x) / hit.bw, 0, 1)
    const ny = clamp((b.y - hit.y) / hit.bh, 0, 1)
    draft.value = { pageId: hit.id, bbox: { x: nx, y: ny, w: 0, h: 0 } }
    drag.value = { mode: drawMode, sx: nx, sy: ny, ox: 0, oy: 0, moved: false }
  } else {
    drag.value = {
      mode: 'pan',
      sx: e.clientX - r.left,
      sy: e.clientY - r.top,
      ox: tx.value,
      oy: ty.value,
      moved: false,
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
    applyScaleAt(pinch.scale * (dist / pinch.dist), pinch.cx, pinch.cy)
    return
  }

  const d = drag.value
  if (!d) return
  const el = vp.value!
  const r = el.getBoundingClientRect()

  if (d.mode === 'pan') {
    const nx = d.ox + (e.clientX - r.left - d.sx)
    const ny = d.oy + (e.clientY - r.top - d.sy)
    if (Math.abs(nx - d.ox) + Math.abs(ny - d.oy) > 3) d.moved = true
    tx.value = nx
    ty.value = ny
    clampPan()
    syncActivePage()
    // 拖动中也要换档：从小缩放大范围拖到某页上时该页要变清晰
    scheduleSrcs()
    return
  }

  const dp = draft.value
  if (!dp) return
  const page = board.value.pages.find(x => x.id === dp.pageId)
  if (!page) return
  const b = toBoard(e.clientX, e.clientY)
  // 严格裁到起点页内：一个框只能挂一页，跨页部分丢弃
  const nx = clamp((b.x - page.x) / page.bw, 0, 1)
  const ny = clamp((b.y - page.y) / page.bh, 0, 1)
  d.moved = Math.abs(nx - d.sx) * page.bw * scale.value > 3
  draft.value = {
    pageId: dp.pageId,
    bbox: {
      x: Math.min(d.sx, nx),
      y: Math.min(d.sy, ny),
      w: Math.abs(nx - d.sx),
      h: Math.abs(ny - d.sy),
    },
  }
}

function onUp(e: PointerEvent) {
  pointers.delete(e.pointerId)
  if (pointers.size < 2) pinch = null
  const d = drag.value
  drag.value = null
  if (!d) return

  if (d.mode === 'pan') {
    /**
     * 短按（没拖动）落在某页上：设为当前页，并且**没铺满视口就放大过去**。
     *
     * 总览态下四页都完整可见，此时「只切页码不缩放」等于点了没反应 —— 用户想要的
     * 是点哪页进哪页。反过来在阅读态（已铺满）就不该重置视角，只切页码。
     */
    if (!d.moved) {
      const p = hitPage(e.clientX, e.clientY)
      if (!p) return
      if (p.id !== props.activePageId) emit('active-page', p.id)
      const fillRatio = (p.bw * scale.value) / vpW.value
      if (fillRatio < 0.9) fitPageWidth(p.id)
    }
    return
  }

  const b = draft.value
  draft.value = null
  if (!b) return
  // 小于 0.4% 的框视为误触（点一下会留下噪点标注）
  if (b.bbox.w > 0.004 && b.bbox.h > 0.004) {
    emit(d.mode === 'cover' ? 'create-cover' : 'create', { pageId: b.pageId, bbox: b.bbox })
  }
}

function onWheel(e: WheelEvent) {
  // Ctrl/⌘ + 滚轮（触控板双指捏合）→ 缩放；普通滚轮 → 平移
  if (e.ctrlKey || e.metaKey) {
    applyScaleAt(scale.value * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY)
    return
  }
  if (e.shiftKey) tx.value -= e.deltaY
  else {
    ty.value -= e.deltaY
    if (e.deltaX) tx.value -= e.deltaX
  }
  clampPan()
  syncActivePage()
  scheduleSrcs()
}

/** 双击：在「聚焦这一页」与「总览全部」之间切换 */
function onDblClick(e: MouseEvent) {
  const hit = hitPage(e.clientX, e.clientY)
  if (!hit) { fitAll(); return }
  const fitW = vpW.value / hit.w
  if (Math.abs(scale.value - fitW) / fitW < 0.08) fitAll()
  else fitPageWidth(hit.id)
}

/**
 * 框选时把小视野放大到能标的比例。
 * 缩到 8% 想框一道题，手指 2px 误差对应题面 25px，框出来必然歪 —— 与其事后让用户
 * 重框，不如切工具时先把当前页放到可操作尺寸。
 */
watch(() => props.tool, (t) => {
  if (t !== 'box' && t !== 'cover') return
  const p = board.value.pages.find(x => x.id === props.activePageId) || board.value.pages[0]
  if (!p || !vpW.value) return
  const fitW = vpW.value / p.w
  if (scale.value < fitW * 0.45) applyScaleAt(fitW, vpW.value / 2, vpH.value / 2)
})

// ── 初次进视图 ──
let inited = false
function initView() {
  if (inited || !board.value.pages.length || !vpW.value) return
  inited = true
  fitPageWidth(props.activePageId || board.value.pages[0].id)
  refreshSrcs()
  emit('ready')
}

let ro: ResizeObserver | null = null
let hoverMq: MediaQueryList | null = null
function syncCoarse() {
  // 两个信号取或：媒体查询在部分安卓 WebView 上不报 (hover: none)，maxTouchPoints 兜底
  coarse.value = (hoverMq?.matches ?? false) || navigator.maxTouchPoints > 0
}

onMounted(() => {
  hoverMq = window.matchMedia('(hover: none)')
  syncCoarse()
  hoverMq.addEventListener?.('change', syncCoarse)

  const el = vp.value
  if (!el) return
  vpW.value = el.clientWidth
  vpH.value = el.clientHeight
  initView()

  if (typeof ResizeObserver === 'undefined') return
  let lastW = vpW.value
  ro = new ResizeObserver(() => {
    const w = el.clientWidth
    const h = el.clientHeight
    if (!w) return
    vpW.value = w
    vpH.value = h
    if (!inited) { initView(); return }
    if (w === lastW) return
    lastW = w
    // 视口宽度变了（顶栏折行、地址栏收起）：保持当前页的适配宽度，别把内容裁掉
    if (board.value.pages.length) fitPageWidth(props.activePageId)
  })
  ro.observe(el)
})

watch(() => props.pages.length, () => { void nextTick(() => initView()) })

onBeforeUnmount(() => {
  hoverMq?.removeEventListener?.('change', syncCoarse)
  ro?.disconnect(); ro = null
  if (srcTimer) clearTimeout(srcTimer)
  if (syncRaf) cancelAnimationFrame(syncRaf)
})

defineExpose({ fitAll, fitPageWidth, focusOn, scrollPageIntoView })
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
.sheet-vp.is-cover { cursor: cell; }
.sheet-blank {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: #a09e97; font-size: 13px;
}

/* 变换层：所有页共享同一套 translate + scale，移动的是相机而不是内容 */
.sheet-board {
  position: absolute; top: 0; left: 0;
  transform-origin: 0 0;
  will-change: transform;
}
.sheet-page {
  position: absolute;
  /* 缩到很小时页与页之间只是一条窄缝，这个阴影是唯一的分界 */
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.14);
  background: #fff;
}
.sheet-img {
  display: block;
  width: 100%; height: 100%;
  background: #fff;
  /* 换档时新旧图会有极短的重叠，淡入比直接跳更不刺眼 */
  transition: opacity 0.12s linear;
}
.page-no {
  position: absolute; left: 0; top: 0;
  font-family: 'DM Mono', monospace;
  line-height: 1;
  color: #fff;
  background: rgba(90, 88, 82, 0.72);
  border-radius: 0 0 4px 0;
  padding: 0.4em 0.6em;
  pointer-events: none;
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
.sheet-anno.k-q { border-color: #5b57c4; background: rgba(91, 87, 196, 0.06); border-style: dashed; }
.sheet-anno.active { box-shadow: 0 0 0 2px rgba(61, 53, 145, 0.35); }
.sheet-anno.draft {
  border-style: dashed;
  border-color: #3d3591;
  background: rgba(61, 53, 145, 0.1);
  pointer-events: none;
}
.sheet-anno.draft-cover {
  border-color: #6b6862;
  background: rgba(107, 104, 98, 0.18);
}

/* 答案遮挡块：必须不透明，半透明等于没遮住 */
.sheet-cover {
  position: absolute;
  box-sizing: border-box;
  border-radius: 3px;
  cursor: pointer;
  background-color: #eeece6;
  background-image: repeating-linear-gradient(
    45deg,
    rgba(0, 0, 0, 0.045) 0 6px,
    transparent 6px 12px
  );
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
  transition: opacity 0.16s ease;
}
.sheet-cover:hover { box-shadow: inset 0 0 0 1px rgba(61, 53, 145, 0.4); }
/* 临时显形：留一层极淡的灰，能看出"这里被遮着"但不挡读 */
.sheet-cover.peeking {
  background-color: transparent;
  background-image: none;
  box-shadow: inset 0 0 0 1.5px rgba(61, 53, 145, 0.5);
}
.cover-tag {
  position: absolute; top: 0; left: 0;
  transform: translate(0, -100%);
  background: #8a8880; color: #fff;
  border-radius: 3px 3px 3px 0;
  font-family: 'DM Mono', monospace; line-height: 1;
  white-space: nowrap;
}
.sheet-cover.peeking .cover-tag { background: #3d3591; }
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
.k-q .anno-num { background: #5b57c4; }

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

@media (max-width: 720px) {
  .sheet-hint {
    left: 10px; bottom: 12px;
    /* 让开右下角缩放条：不给上限时两段字在窄屏上会直接叠成一片 */
    max-width: calc(100% - 132px);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .sheet-zoombar { right: 10px; bottom: 10px; }
}
</style>
