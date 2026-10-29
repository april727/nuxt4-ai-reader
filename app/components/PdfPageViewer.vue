<template>
  <Teleport to="body">
    <div v-if="open" class="pdfv-mask" @click.self="emit('close')">
      <div class="pdfv">
        <header class="pdfv-bar">
          <div class="pdfv-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span>PDF 原文</span>
            <em v-if="hlCount" class="pdfv-hint">{{ hlCount }} 处标记在此页</em>
          </div>

          <div class="pdfv-nav">
            <button class="pdfv-btn" :disabled="pageNum <= 1" title="上一页" @click="go(-1)">‹</button>
            <input
              class="pdfv-pageinput"
              type="text"
              :value="String(pageNum)"
              title="输入页码后回车"
              @change="onPageInput"
            />
            <span class="pdfv-pagetotal">/ {{ pageCount || '—' }}</span>
            <button class="pdfv-btn" :disabled="!pageCount || pageNum >= pageCount" title="下一页" @click="go(1)">›</button>
          </div>

          <div class="pdfv-tools">
            <button class="pdfv-btn" title="缩小" @click="setZoom(zoom - 0.2)">−</button>
            <span class="pdfv-zoom">{{ Math.round(zoom * 100) }}%</span>
            <button class="pdfv-btn" title="放大" @click="setZoom(zoom + 0.2)">+</button>
            <button class="pdfv-btn pdfv-btn--wide" title="按宽度铺满" @click="zoom = 1">适宽</button>
          </div>

          <button class="pdfv-close" title="关闭（Esc）" @click="emit('close')">×</button>
        </header>

        <div ref="bodyEl" class="pdfv-body">
          <div class="pdfv-stage" :style="stageStyle">
            <canvas ref="canvasEl" class="pdfv-canvas"></canvas>
            <div class="pdfv-layer">
              <div
                v-for="h in highlights"
                :key="h.key"
                class="pdfv-hl"
                :class="{ 'pdfv-hl--flash': h.flash }"
                :style="h.style"
                :title="h.label"
              ></div>
            </div>
            <div v-if="status" class="pdfv-status">{{ status }}</div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * PDF 原页查看器（自渲染，不用 iframe）
 *
 * 为什么必须自己画：浏览器内置 PDF 插件是一个黑盒，拿不到 DOM、选区、
 * 滚动位置，因此**无法在原文上叠任何东西**。要做「标记的第二个视图」，
 * 只能 canvas + 自己定位高亮层。
 *
 * 坐标约定：anchors 给的是 PDF 用户空间（原点左下、y 向上）。换算走
 * viewport.convertToViewportPoint，比自己算 `页高 - y` 稳 —— 页面有旋转、
 * CropBox 有偏移时，手算角度会整体歪掉。
 *
 * 只读：这一版不接收划词，原页划词属于 L2（需要把选区反查回段落偏移）。
 */

/** 与 server/utils/pdfLayout.ts 的 PdfRect 一致（PDF 用户空间，原点左下） */
interface PdfRect { p: number; x: number; y: number; w: number; h: number }

const props = withDefaults(defineProps<{
  open: boolean
  src: string
  /** 初始页码（1 基）。null 表示从第 1 页 */
  page?: number | null
  /** /api/pdf/anchors 的返回，没有坐标表时传 null */
  anchors?: {
    pageCount: number
    pages: { page: number; width: number; height: number }[]
    marks: Record<string, PdfRect[]>
    paragraphs: Record<string, { page: number; rect: PdfRect | null; coverage: number }>
  } | null
  /** 标记元数据（颜色、文本），用于上色和悬停提示 */
  marks?: { id: string; text: string; color?: string; type?: string }[]
  /** 打开后要定位的段落（会跳到该段所在页并闪一下） */
  focusParagraph?: string | null
}>(), { page: 1, anchors: null, marks: () => [], focusParagraph: null })

const emit = defineEmits<{ close: [] }>()

const bodyEl = ref<HTMLElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const pageNum = ref(1)
const pageCount = ref(0)
const zoom = ref(1)
const status = ref('')
const stageStyle = ref<Record<string, string>>({})
const highlights = ref<{ key: string; style: Record<string, string>; label: string; flash?: boolean }[]>([])

// pdfjs 文档对象**不能**放进 ref/reactive：它内部是 class 实例，
// 被 Vue 代理后 getPage 里的 this 会指向 Proxy，报私有字段访问错误。
let pdfDoc: any = null
let pdfjsLib: any = null
let renderTask: any = null
let rendering = false
/** 下一次渲染完成后是否要把首个高亮滚进视野（换页、首次打开时为 true） */
let pendingScroll = false

const hlCount = computed(() => {
  const a = props.anchors
  if (!a) return 0
  let n = 0
  for (const m of props.marks) {
    const rects = a.marks?.[m.id]
    if (rects?.some((r) => r.p === pageNum.value)) n++
  }
  return n
})

async function loadPdfjs() {
  if (pdfjsLib) return pdfjsLib
  const lib: any = await import('pdfjs-dist/build/pdf.min.mjs')
  const worker: any = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  lib.GlobalWorkerOptions.workerSrc = worker.default
  pdfjsLib = lib
  return lib
}

async function init() {
  if (!props.src) return
  status.value = '加载中…'
  try {
    const lib = await loadPdfjs()
    pdfDoc = await lib.getDocument({ url: props.src, isEvalSupported: false }).promise
    pageCount.value = pdfDoc.numPages
    const target = props.focusParagraph && props.anchors?.paragraphs?.[props.focusParagraph]?.page
    pageNum.value = clampPage(target || props.page || 1)
    pendingScroll = true
    await render()
  } catch (err: any) {
    status.value = 'PDF 加载失败：' + (err?.message || err)
  }
}

function clampPage(n: number) {
  if (!pageCount.value) return Math.max(1, n)
  return Math.min(pageCount.value, Math.max(1, n))
}

function go(delta: number) {
  pageNum.value = clampPage(pageNum.value + delta)
  pendingScroll = true
  render()
}

function onPageInput(e: Event) {
  const n = parseInt((e.target as HTMLInputElement).value, 10)
  if (Number.isFinite(n)) {
    pageNum.value = clampPage(n)
    pendingScroll = true
    render()
  } else {
    (e.target as HTMLInputElement).value = String(pageNum.value)
  }
}

function setZoom(z: number) {
  zoom.value = Math.min(4, Math.max(0.4, +z.toFixed(2)))
  render()
}

/** 按容器宽度的适宽比例 × 用户缩放 */
async function render() {
  if (!pdfDoc || rendering) return
  rendering = true
  status.value = ''
  try {
    const page = await pdfDoc.getPage(pageNum.value)
    const base = page.getViewport({ scale: 1 })
    const avail = (bodyEl.value?.clientWidth || 900) - 32
    const fit = Math.max(0.2, avail / base.width)
    const scale = fit * zoom.value
    const vp = page.getViewport({ scale })

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const canvas = canvasEl.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = Math.floor(vp.width * dpr)
    canvas.height = Math.floor(vp.height * dpr)
    canvas.style.width = `${vp.width}px`
    canvas.style.height = `${vp.height}px`
    stageStyle.value = { width: `${vp.width}px`, height: `${vp.height}px` }

    if (renderTask) { try { renderTask.cancel() } catch {} }
    renderTask = page.render({
      canvasContext: ctx,
      viewport: vp,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    })
    await renderTask.promise
    renderTask = null

    buildHighlights(vp)
  } catch (err: any) {
    if (err?.name !== 'RenderingCancelledException') {
      status.value = '渲染失败：' + (err?.message || err)
    }
  } finally {
    rendering = false
  }
}

/** 把当前页的标记矩形换算成屏幕坐标 */
function buildHighlights(vp: any) {
  const out: typeof highlights.value = []
  const a = props.anchors
  if (!a) { highlights.value = out; return }

  const toBox = (r: PdfRect) => {
    // transform[5] 是基线，字顶大约在 baseline + 0.8*字号，字底在 -0.2*字号。
    // 直接用基线当顶会让高亮整体下移两成行高，视觉上"压住"下一行。
    const [x1, y1] = vp.convertToViewportPoint(r.x, r.y + r.h * 0.8)
    const [x2, y2] = vp.convertToViewportPoint(r.x + r.w, r.y - r.h * 0.2)
    const left = Math.min(x1, x2)
    const top = Math.min(y1, y2)
    return {
      left: `${left.toFixed(2)}px`,
      top: `${top.toFixed(2)}px`,
      width: `${Math.abs(x2 - x1).toFixed(2)}px`,
      height: `${Math.abs(y2 - y1).toFixed(2)}px`,
    }
  }

  for (const m of props.marks) {
    const rects = a.marks?.[m.id]
    if (!rects) continue
    rects.filter((r) => r.p === pageNum.value).forEach((r, i) => {
      const c = m.color || 'rgba(245,158,11,0.42)'
      out.push({
        key: `${m.id}-${i}`,
        style: { ...toBox(r), background: c },
        label: m.text || '',
      })
    })
  }

  // 从段落跳过来时，把该段第一行框出来闪一下 —— 一个词的高亮在整页里太不显眼
  const para = props.focusParagraph ? a.paragraphs?.[props.focusParagraph] : null
  if (para?.rect && para.rect.p === pageNum.value) {
    out.push({
      key: 'flash',
      style: { ...toBox(para.rect) },
      label: '',
      flash: true,
    })
  }

  highlights.value = out

  // 换页/首次打开时把第一个高亮带进视野：适宽后整页高于容器，不滚的话
  // 用户看到的往往是页眉，而标记都在正文中段
  if (pendingScroll && out.length) {
    pendingScroll = false
    nextTick(() => {
      const el = document.querySelector('.pdfv-hl:not(.pdfv-hl--flash)') as HTMLElement | null
      const body = bodyEl.value
      if (!el || !body) return
      const r = el.getBoundingClientRect()
      const b = body.getBoundingClientRect()
      if (r.top < b.top + 24 || r.bottom > b.bottom - 24) {
        body.scrollTop += (r.top - b.top) - b.height * 0.34
      }
    })
  } else {
    pendingScroll = false
  }
}

// 打开时才初始化；重复打开复用同一个 pdfDoc（换页比重新拉整本快得多）
watch(() => props.open, async (v) => {
  if (!v) return
  if (pdfDoc && props.src) {
    const target = props.focusParagraph && props.anchors?.paragraphs?.[props.focusParagraph]?.page
    pageNum.value = clampPage(target || props.page || pageNum.value)
    pendingScroll = true
    await nextTick()
    await render()
    return
  }
  await nextTick()
  await init()
})

watch(() => props.page, (v) => {
  if (!props.open || v == null) return
  pageNum.value = clampPage(v)
  pendingScroll = true
  render()
})

function onKey(e: KeyboardEvent) {
  if (!props.open) return
  if (e.key === 'Escape') emit('close')
  else if (e.key === 'ArrowLeft') go(-1)
  else if (e.key === 'ArrowRight') go(1)
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  if (renderTask) { try { renderTask.cancel() } catch {} }
  try { pdfDoc?.destroy?.() } catch {}
})

// 窗口尺寸变化时重新适宽（不改 zoom，只重算 fit）
let resizeTimer: any = null
function onResize() {
  if (!props.open) return
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => render(), 220)
}
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => { window.removeEventListener('resize', onResize); clearTimeout(resizeTimer) })
</script>

<style scoped>
.pdfv-mask {
  position: fixed;
  inset: 0;
  z-index: 6000;
  background: rgba(15, 23, 42, 0.62);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.pdfv {
  width: min(1100px, 94vw);
  height: min(92vh, 1100px);
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.34);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pdfv-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  border-bottom: 1px solid #e8ecf1;
  flex-shrink: 0;
  font-family: 'DM Sans', system-ui, sans-serif;
}

.pdfv-title {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #1e293b;
  font-weight: 600;
  font-size: 13.5px;
  flex: 1;
  min-width: 0;
}

.pdfv-hint {
  font-style: normal;
  font-weight: 500;
  font-size: 11.5px;
  color: #8a6d1f;
  background: rgba(245, 158, 11, 0.14);
  border-radius: 999px;
  padding: 2px 8px;
  white-space: nowrap;
}

.pdfv-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pdfv-btn {
  width: 26px;
  height: 26px;
  border: 1px solid #e2e8f0;
  background: #fff;
  border-radius: 7px;
  color: #475569;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.14s, border-color 0.14s;
}
.pdfv-btn:hover:not(:disabled) { background: #f1f5f9; border-color: #cbd5e1; }
.pdfv-btn:disabled { opacity: 0.38; cursor: default; }
.pdfv-btn--wide { width: auto; padding: 0 9px; font-size: 12px; }

.pdfv-pageinput {
  width: 42px;
  height: 26px;
  text-align: center;
  border: 1px solid #e2e8f0;
  border-radius: 7px;
  font-size: 12.5px;
  color: #1e293b;
  font-variant-numeric: tabular-nums;
}
.pdfv-pageinput:focus { outline: none; border-color: #3d3591; }

.pdfv-pagetotal {
  font-size: 12px;
  color: #94a3b8;
  min-width: 36px;
}

.pdfv-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 10px;
  border-left: 1px solid #eef2f7;
}

.pdfv-zoom {
  font-size: 11.5px;
  color: #64748b;
  min-width: 38px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.pdfv-close {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: #94a3b8;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  border-radius: 8px;
}
.pdfv-close:hover { background: #f1f5f9; color: #475569; }

.pdfv-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: #eef1f6;
  display: flex;
  /* 放大到超过容器宽度时，普通 center 会让左侧溢出的部分永远滚不到
     （内容居中后 scrollLeft 的最小值仍是 0，左边就是露不出来）；
     safe center 在溢出时退回 start，横向滚动才拿得到整页 */
  justify-content: center;
  justify-content: safe center;
  padding: 16px;
}

.pdfv-stage {
  position: relative;
  background: #fff;
  box-shadow: 0 2px 14px rgba(15, 23, 42, 0.13);
  height: fit-content;
}

.pdfv-canvas {
  display: block;
}

.pdfv-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.pdfv-hl {
  position: absolute;
  border-radius: 2px;
  /* multiply 让高亮底下的字透出来 —— 纯半透明叠加会把黑字洗淡 */
  mix-blend-mode: multiply;
  pointer-events: auto;
  cursor: default;
  transition: box-shadow 0.15s;
}
.pdfv-hl:hover { box-shadow: 0 0 0 1.5px rgba(245, 158, 11, 0.9); }

.pdfv-hl--flash {
  background: transparent;
  border: 2px solid #3d3591;
  border-radius: 4px;
  animation: pdfv-flash 1.5s ease-out 2;
}

@keyframes pdfv-flash {
  0% { opacity: 1; box-shadow: 0 0 0 4px rgba(61, 53, 145, 0.18); }
  70% { opacity: 0.85; }
  100% { opacity: 0; }
}

.pdfv-status {
  position: absolute;
  left: 50%;
  top: 18px;
  transform: translateX(-50%);
  padding: 5px 12px;
  border-radius: 999px;
  background: rgba(30, 41, 59, 0.86);
  color: #fff;
  font-size: 12px;
  white-space: nowrap;
}

@media (max-width: 760px) {
  .pdfv-mask { padding: 0; }
  .pdfv { width: 100vw; height: 100dvh; border-radius: 0; }
  /* 一行必须放得下：标题只留图标，"PDF 原文" 四个字挤在这里会竖排换行 */
  .pdfv-bar { gap: 6px; padding: 8px 10px; flex-wrap: nowrap; }
  .pdfv-title { flex: 0 0 auto; }
  .pdfv-title span { display: none; }
  .pdfv-hint { display: none; }
  .pdfv-tools { padding-left: 6px; }
  .pdfv-pagetotal { min-width: 28px; }
  .pdfv-body { padding: 8px; }
}
</style>
