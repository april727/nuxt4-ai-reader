<script setup lang="ts">
/**
 * 段落导航（ParaMinimap）
 *
 * 形态对齐 WorkBuddy 会话历史浮层：
 * 右侧常驻一条极短的刻度轨（细短线，仅作位置提示），
 * 悬停/点击后向左侧展开面板，**列出全部段落**，
 * 点选某一段即跳转，选中行文字加深、短线变长变黑。
 *
 * 与上一版的关键差异
 * ─────────────────
 * 1. 刻度从「宽条密排」改为「短细线 + 大间距」，不再拥挤。
 * 2. 不再用单个气泡显示一段文字，而是整块面板列出所有段落，可滚动、可选择。
 * 3. 面板列出的是全量段落，因此刻度轨即使做了聚合，也不损失选择精度。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

interface ParaLite { id: string; text?: string }
interface MarkLite { paraId: string; type: string }

const props = withDefaults(defineProps<{
  paragraphs: ParaLite[]
  currentIndex: number
  marks?: MarkLite[]
  hidden?: boolean
}>(), { marks: () => [], hidden: false })

const emit = defineEmits<{ jump: [index: number] }>()

/** 刻度轨节距：2px 线 + 8px 间隙 */
const PITCH = 12
const MAX_HEIGHT_RATIO = 0.7
const MAX_HEIGHT_PX = 600

const rootEl = ref<HTMLElement | null>(null)
const railEl = ref<HTMLElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const viewportH = ref(typeof window !== 'undefined' ? window.innerHeight : 800)
const open = ref(false)
const ready = ref(false)
/** 当前悬停的段落下标（框内行与侧栏刻度共用同一状态，实现双向联动） */
const hoverParaIndex = ref<number | null>(null)

let closeTimer: ReturnType<typeof setTimeout> | null = null

// ── 刻度轨 ────────────────────────────────────────────
const maxTicks = computed(() => {
  const h = Math.min(MAX_HEIGHT_PX, viewportH.value * MAX_HEIGHT_RATIO)
  return Math.max(8, Math.floor(h / PITCH))
})
const tickCount = computed(() => Math.min(props.paragraphs.length, maxTicks.value))
const groupSize = computed(() => {
  if (!tickCount.value) return 1
  return Math.ceil(props.paragraphs.length / tickCount.value) || 1
})

const markByPara = computed(() => {
  const weight: Record<string, number> = { word: 3, phrase: 2, sentence: 1 }
  const map = new Map<string, string>()
  for (const m of props.marks) {
    const prev = map.get(m.paraId)
    if (!prev || (weight[m.type] || 0) > (weight[prev] || 0)) map.set(m.paraId, m.type)
  }
  return map
})

const currentTick = computed(() => {
  if (!tickCount.value) return 0
  return Math.min(tickCount.value - 1, Math.floor(props.currentIndex / groupSize.value))
})

interface Tick { i: number; state: 'past' | 'current' | 'future'; mark: string | null }
const ticks = computed<Tick[]>(() => {
  const out: Tick[] = []
  const gs = groupSize.value
  for (let i = 0; i < tickCount.value; i++) {
    const from = i * gs
    const to = Math.min(from + gs, props.paragraphs.length)
    let mark: string | null = null
    for (let p = from; p < to; p++) {
      const m = markByPara.value.get(props.paragraphs[p]?.id || '')
      if (m) { mark = m; break }
    }
    const state: Tick['state'] = i === currentTick.value ? 'current' : (to <= props.currentIndex ? 'past' : 'future')
    out.push({ i, state, mark })
  }
  return out
})

// ── 面板行 ────────────────────────────────────────────
/** Markdown → 纯文本（预览只展示"人话"，不暴露源码符号） */
function mdToPlain(md: string): string {
  let s = String(md || '')
  s = s.replace(/```[\s\S]*?```/g, ' ')
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  s = s.replace(/^\s{0,3}>\s?/gm, '')
  s = s.replace(/^\s{0,3}[-*+]\s+/gm, '')
  s = s.replace(/^\s{0,3}\d+\.\s+/gm, '')
  s = s.replace(/`([^`]*)`/g, '$1')
  s = s.replace(/(\*\*|__)(.*?)\1/g, '$2')
  s = s.replace(/(\*|_)(.*?)\1/g, '$2')
  s = s.replace(/~~(.*?)~~/g, '$1')
  s = s.replace(/<[^>]+>/g, ' ')
  s = s.replace(/\|/g, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

const rows = computed(() => props.paragraphs.map((p, i) => {
  const plain = mdToPlain(p.text || '')
  // 截断交给 CSS（ellipsis），避免 JS 与 CSS 双重截断出现两个省略号
  return { i, label: plain || '（空段落）', mark: markByPara.value.get(p.id) || null }
}))

/** 悬停段落对应的刻度下标 —— 用于让侧栏刻度同步高亮 */
const hoverTickIdx = computed(() =>
  hoverParaIndex.value == null ? null : Math.floor(hoverParaIndex.value / groupSize.value),
)

/** 侧栏指针位置 → 刻度 → 段落，反向驱动框内高亮 */
function onRailMove(e: PointerEvent) {
  const track = railEl.value?.firstElementChild as HTMLElement | null
  if (!track || !tickCount.value) return
  const rect = track.getBoundingClientRect()
  const i = Math.round((e.clientY - rect.top) / PITCH)
  const clamped = Math.max(0, Math.min(tickCount.value - 1, i))
  hoverParaIndex.value = clamped * groupSize.value
}

// ── 开合与跳转 ────────────────────────────────────────
function cancelClose() {
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
}

/** 悬停意图：必须停留这么久才展开，避免从正文移向右侧面板时"路过即触发" */
const HOVER_INTENT_MS = 400
/** 离开后延迟收起，容忍指针短暂掠过 */
const CLOSE_DELAY_MS = 320

let openTimer: ReturnType<typeof setTimeout> | null = null

function cancelOpen() {
  if (openTimer) { clearTimeout(openTimer); openTimer = null }
}

function openPanel() {
  cancelOpen()
  cancelClose()
  if (open.value) return
  open.value = true
  nextTick(() => scrollActiveIntoView())
}

function scheduleClose() {
  cancelOpen()
  cancelClose()
  closeTimer = setTimeout(() => { open.value = false; hoverParaIndex.value = null }, CLOSE_DELAY_MS)
}

function togglePanel() {
  cancelOpen()
  if (open.value) { open.value = false; hoverParaIndex.value = null }
  else openPanel()
}

/**
 * 指针进入：只有鼠标才走「悬停意图」，且需停留 HOVER_INTENT_MS。
 * 触摸设备不预展开，必须点按（避免阅读时手指滑过就弹面板）。
 */
function onRootEnter(e: PointerEvent) {
  if (e.pointerType !== 'mouse') return
  cancelClose()
  if (open.value) return
  cancelOpen()
  openTimer = setTimeout(() => { openTimer = null; openPanel() }, HOVER_INTENT_MS)
}

function onRootLeave() {
  cancelOpen()
  scheduleClose()
}

function scrollActiveIntoView() {
  const el = listEl.value
  if (!el) return
  const active = el.querySelector('.pm-row.is-active') as HTMLElement | null
  if (!active) return
  const top = active.offsetTop - el.clientHeight / 2 + active.clientHeight / 2
  el.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
}

function selectRow(i: number) {
  if (i === props.currentIndex) { open.value = false; return }
  emit('jump', i)
  // 移动端点选后收起，桌面端保持展开便于连续跳转
  if (window.matchMedia?.('(pointer: coarse)')?.matches) open.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) { open.value = false; return }
  if (!open.value) return
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault()
    const step = e.key === 'ArrowUp' ? -1 : 1
    const next = Math.max(0, Math.min(props.paragraphs.length - 1, props.currentIndex + step))
    if (next !== props.currentIndex) emit('jump', next)
  }
}

function onDocPointerDown(e: PointerEvent) {
  if (!open.value) return
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) open.value = false
}

function onResize() { viewportH.value = window.innerHeight }

onMounted(() => {
  onResize()
  window.addEventListener('resize', onResize)
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('pointerdown', onDocPointerDown)
  requestAnimationFrame(() => { ready.value = true })
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('pointerdown', onDocPointerDown)
  cancelClose()
  cancelOpen()
})

// 跳转后让选中行保持可见
watch(() => props.currentIndex, () => { if (open.value) nextTick(() => scrollActiveIntoView()) })
</script>

<template>
  <div
    v-if="!hidden && paragraphs.length > 1"
    ref="rootEl"
    class="pm-root"
    :class="{ open, ready }"
    @pointerenter="onRootEnter"
    @pointerleave="onRootLeave"
  >
    <!-- 常驻刻度轨：短细线，只作位置提示 -->
    <div
      class="pm-rail"
      @click="togglePanel"
      @pointermove="onRailMove"
      @pointerleave="hoverParaIndex = null"
      role="button"
      tabindex="0"
      :aria-expanded="open"
      aria-label="段落导航"
    >
      <div ref="railEl" class="pm-rail-track" :style="{ height: Math.max(0, tickCount * PITCH - 4) + 'px' }">
        <span
          v-for="t in ticks"
          :key="t.i"
          class="pm-dash"
          :class="[`is-${t.state}`, t.mark ? `mark-${t.mark}` : '', { 'is-hover': hoverTickIdx === t.i && t.i !== currentTick }]"
          :style="{ top: (t.i * PITCH) + 'px' }"
        />
        <span
          class="pm-cursor"
          :class="{ 'is-linked': hoverTickIdx === currentTick }"
          :style="{ transform: `translateY(${currentTick * PITCH}px)` }"
        />
      </div>
    </div>

    <!-- 段落列表面板 -->
    <Transition name="pm-pop">
      <div v-if="open" class="pm-panel">
        <div class="pm-panel-head">
          <span class="pm-panel-title">段落</span>
          <span class="pm-panel-count">{{ currentIndex + 1 }} / {{ paragraphs.length }}</span>
        </div>
        <div ref="listEl" class="pm-list">
          <button
            v-for="r in rows"
            :key="r.i"
            class="pm-row"
            :class="{ 'is-active': r.i === currentIndex, 'is-hover': hoverParaIndex === r.i }"
            @pointerenter="hoverParaIndex = r.i"
            @pointerleave="hoverParaIndex = null"
            @click="selectRow(r.i)"
          >
            <span class="pm-row-num">{{ r.i + 1 }}</span>
            <span class="pm-row-text">{{ r.label }}</span>
            <span class="pm-row-dash" :class="r.mark ? `mark-${r.mark}` : ''" />
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.pm-root {
  position: fixed;
  /* 落在正文左侧留白（段落序号列的空白区），不再挡在正文与右侧面板之间。
     12px 起：避开左侧 8px 滚动条，且不压住从 38px 开始的段落序号 */
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 45;
  opacity: 0;
  transition: opacity 0.36s ease, transform 0.36s cubic-bezier(0.22, 0.61, 0.36, 1);
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
}
.pm-root.ready { opacity: 0.55; }
.pm-root.ready.open,
.pm-root.ready:hover { opacity: 1; }

/* ── 刻度轨 ─────────────────────────────────── */
.pm-rail {
  /* 放在左留白内，比初版略大便于点按，且不压段落序号 */
  padding: 10px 3px;
  border-radius: 8px;
  cursor: pointer;
  background: rgba(252, 251, 249, 0.42);
  backdrop-filter: blur(8px) saturate(1.05);
  -webkit-backdrop-filter: blur(8px) saturate(1.05);
  transition: background 0.22s ease, box-shadow 0.22s ease;
}
.pm-rail:hover {
  background: rgba(252, 251, 249, 0.72);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.06);
}

.pm-rail-track { position: relative; width: 14px; }

.pm-dash {
  position: absolute;
  right: 0;
  width: 12px;
  height: 2px;
  border-radius: 1px;
  background: #e4e2db;
  transition: width 0.2s cubic-bezier(0.22, 0.61, 0.36, 1), background-color 0.24s ease;
}
.pm-root.open .pm-dash { width: 9px; }
.pm-dash.is-past { background: #d8d5cb; }
.pm-dash.is-future { background: #ebe9e2; }
.pm-dash.is-current { background: #cfccc2; }
.pm-dash.mark-word { background: #ba7517; }
.pm-dash.mark-phrase { background: #1d9e75; }
.pm-dash.mark-sentence { background: #d4537e; }

/* 悬停联动：框内悬停哪一段，侧栏对应刻度同步加长加深 */
.pm-dash.is-hover {
  width: 14px !important;
  background: #3d3591 !important;
  transition: width 0.16s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.16s ease;
}

/* 当前段：短线变长变黑，与参考图一致 */
.pm-cursor {
  position: absolute;
  top: 0;
  right: 0;
  width: 14px;
  height: 2px;
  border-radius: 1px;
  background: #1a1a18;
  transition: transform 0.3s cubic-bezier(0.22, 0.61, 0.36, 1), background-color 0.16s ease, box-shadow 0.16s ease;
  pointer-events: none;
}
/* 悬停的正是当前段时：不叠加第二条，只让光标本身转为联动色并带一圈光晕 */
.pm-cursor.is-linked {
  background: #3d3591;
  box-shadow: 0 0 0 2px rgba(61, 53, 145, 0.16);
}

/* ── 面板 ───────────────────────────────────── */
.pm-panel {
  position: absolute;
  /* 轨道在左缘，面板向右展开压住正文，而不是飞出屏幕外 */
  left: calc(100% + 4px);
  right: auto;
  top: 50%;
  transform: translateY(-50%);
  width: 252px;
  max-height: 66vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 9px 10px 9px 6px;
  border-radius: 14px;
  background: rgba(252, 251, 249, 0.82);
  backdrop-filter: blur(18px) saturate(1.1);
  -webkit-backdrop-filter: blur(18px) saturate(1.1);
  border: 0.5px solid rgba(255, 255, 255, 0.6);
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.1);
}

.pm-panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 8px 5px 0;
  margin-bottom: 2px;
  border-bottom: 0.5px solid rgba(0, 0, 0, 0.06);
}
.pm-panel-title { font-size: 11.5px; font-weight: 500; color: #1a1a18; }
.pm-panel-count { font-size: 10.5px; color: #a09e97; font-family: 'DM Mono', monospace; }

/* 关键：flex 纵列里的滚动容器必须给 min-height:0，
   否则子项按内容高度撑开、绕过 max-height，滚动条不出现（几百段时表现为"面板撑破/无法显示"） */
.pm-list {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #c4c2ba transparent;
  padding-right: 4px;
}
.pm-list::-webkit-scrollbar { width: 7px; }
.pm-list::-webkit-scrollbar-thumb { background: #c4c2ba; border-radius: 4px; }
.pm-list::-webkit-scrollbar-thumb:hover { background: #a09e97; }
.pm-list::-webkit-scrollbar-track { background: transparent; }

.pm-row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 8px 7px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.14s ease;
}
.pm-row.is-hover { background: rgba(0, 0, 0, 0.048); }
.pm-row:focus-visible { outline: none; box-shadow: 0 0 0 1.5px rgba(61, 53, 145, 0.35); }

/* 悬停跳动：轻微上弹再落回，带一点回弹曲线，避免生硬的位移 */
@keyframes pm-row-bounce {
  0%   { transform: translateY(0) scale(1); }
  38%  { transform: translateY(-2.5px) scale(1.012); }
  68%  { transform: translateY(0.6px) scale(1); }
  100% { transform: translateY(0) scale(1); }
}
.pm-row.is-hover { animation: pm-row-bounce 0.36s cubic-bezier(0.34, 1.56, 0.64, 1); }

/* 段落序号：右对齐等宽数字，弱化存在感但不失可读 */
.pm-row-num {
  flex: 0 0 auto;
  min-width: 15px;
  text-align: right;
  font-size: 10.5px;
  font-family: 'DM Mono', monospace;
  color: #c0bdb4;
  transition: color 0.16s ease;
}

/* 文字左对齐并单行截断 */
.pm-row-text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.55;
  color: #a09e97;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.16s ease, font-weight 0.16s ease;
}

.pm-row-dash {
  flex-shrink: 0;
  width: 10px;
  height: 2px;
  border-radius: 1px;
  background: #d8d5cb;
  transition: width 0.2s cubic-bezier(0.22, 0.61, 0.36, 1), background-color 0.2s ease;
}
.pm-row-dash.mark-word { background: #ba7517; }
.pm-row-dash.mark-phrase { background: #1d9e75; }
.pm-row-dash.mark-sentence { background: #d4537e; }

/* 悬浮行：文字与短线一并加深 */
.pm-row.is-hover .pm-row-text { color: #2f2f2b; }
.pm-row.is-hover .pm-row-num { color: #6b6963; }
.pm-row.is-hover .pm-row-dash { width: 16px; background: #6b6963; }

/* 当前段：文字最深加粗，短线最长且纯黑 —— 与悬浮行形成层级差 */
.pm-row.is-active .pm-row-text { color: #1a1a18; font-weight: 500; }
.pm-row.is-active .pm-row-num { color: #1a1a18; }
.pm-row.is-active .pm-row-dash { width: 18px; background: #1a1a18; }

/* ── 动画 ───────────────────────────────────── */
.pm-pop-enter-active,
.pm-pop-leave-active {
  transition: opacity 0.2s ease, transform 0.24s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.pm-pop-enter-from,
.pm-pop-leave-to {
  opacity: 0;
  transform: translateY(-50%) translateX(-10px) scale(0.985);
}
.pm-pop-enter-to,
.pm-pop-leave-from {
  opacity: 1;
  transform: translateY(-50%) translateX(0) scale(1);
}

/* 移动端：面板更宽、行更高，便于点按 */
@media (max-width: 767px) {
  /* 移动端阅读区左留白较窄（20px），轨道贴到 2px 起，避免压住序号 */
  .pm-root { left: 2px; }
  .pm-panel { width: min(72vw, 258px); max-height: 60vh; }
  .pm-row { padding: 10px 7px; }
  .pm-row-text { font-size: 13px; }
}

@media (prefers-reduced-motion: reduce) {
  .pm-root, .pm-dash, .pm-cursor, .pm-panel, .pm-row, .pm-row-text, .pm-row-dash {
    transition-duration: 0.01ms !important;
  }
}
</style>