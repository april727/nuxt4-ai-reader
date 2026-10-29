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
          <div class="pdfv-stage" :style="stageStyle" @mouseup="onSelectionEnd">
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
            <!-- 选区层：透明文字，只为让浏览器在那里画原生选区蓝 -->
            <div ref="textEl" class="pdfv-text"></div>
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
 * 三层结构按 DOM 顺序叠：canvas（画面）→ 高亮层（半透明色块）→ 选区层（透明文字）。
 * 选区层必须能真正被选中，所以文字是**透明**的而不是隐藏的：canvas 上已经画了字，
 * 这里只负责给浏览器提供可选择的文本节点，选区蓝会自然盖在色块上。
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

const emit = defineEmits<{
  (e: 'close'): void
  /** 用户在原页上选中了一段文字。rects 是选区的 PDF 坐标，建完标记直接当高亮用 */
  (e: 'select-text', p: { page: number; text: string; rects: PdfRect[]; clientRect: { left: number; top: number; right: number; bottom: number } }): void
}>()

const bodyEl = ref<HTMLElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const textEl = ref<HTMLElement | null>(null)
const pageNum = ref(1)
const pageCount = ref(0)
const zoom = ref(1)
const status = ref('')
const stageStyle = ref<Record<string, string>>({})
const highlights = ref<{ key: string; style: Record<string, string>; label: string; flash?: boolean }[]>([])
/**
 * 本次会话里新建的标记矩形（原页划词产生）。
 * 服务端的 anchors 是打开时拉的快照，不含刚建的标记；不在这里补一份，
 * 用户「划完就消失了」—— 得关掉重开才看得到。
 */
const localRects = ref<Record<string, PdfRect[]>>({})

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
    const rects = localRects.value[m.id] || a.marks?.[m.id]
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
  lastSelKey = ''
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

    lastVp = vp
    buildHighlights(vp)
    // 文字层要等 canvas 落笔后再建：它的目的是给浏览器提供可选文本，
    // 先建的话用户可能选到一段还没画出来的内容，选区高亮却已经出现
    await buildTextLayer(page, vp)
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
    const rects = localRects.value[m.id] || a.marks?.[m.id]
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

/** 当前页的 viewport，选区换算要用 */
let lastVp: any = null

/** 把当前页文字铺成透明 span，供浏览器做选区 */
async function buildTextLayer(page: any, vp: any) {
  const host = textEl.value
  if (!host) return
  host.innerHTML = ''
  let items: any[] = []
  try {
    const tc = await page.getTextContent()
    items = tc.items || []
  } catch { return }

  const frag = document.createDocumentFragment()
  const pending: { el: HTMLSpanElement; width: number }[] = []
  // 词间距判定：和 parse_pdf_layout.mjs 用同一个系数。多数排版好的 PDF
  // 内容流里**根本没有空格字符**，词与词之间只有坐标间隔 —— 照搬条目文本
  // 会让选区变成 "Troy,Imustadmit"，反查段落时整串都切不开。
  let prevRight: number | null = null
  let prevTop: number | null = null
  for (const it of items) {
    const str = String(it.str ?? '')
    if (!str.trim()) continue
    const tx = pdfjsLib.Util.transform(vp.transform, it.transform)
    const fontH = Math.hypot(tx[2], tx[3]) || 10
    const width = it.width * vp.scale
    const sameLine = prevTop !== null && Math.abs(tx[5] - prevTop) < fontH * 0.5
    const gap = prevRight === null ? 0 : tx[4] - prevRight
    const needsSpace = sameLine && gap > fontH * 0.18 && !/\s$/.test(str)

    const span = document.createElement('span')
    // 前导空格把间隔补回来：词号取自 span 文本，位置仍由 left 决定
    span.textContent = needsSpace && !/^\s/.test(str) ? ' ' + str : str
    // 下标不参与定位，只用于排查「选中的是哪个条目」
    span.dataset.i = String(frag.childNodes.length)
    span.style.left = `${tx[4].toFixed(2)}px`
    span.style.top = `${(tx[5] - fontH).toFixed(2)}px`
    span.style.fontSize = `${fontH.toFixed(2)}px`
    frag.appendChild(span)
    pending.push({ el: span, width })
    prevRight = tx[4] + width
    prevTop = tx[5]
  }
  host.appendChild(frag)

  // 字体不同 → 同样的字号排出来的宽度和 PDF 里的不一致。按条目已知宽度
  // 横向缩放对齐：目标宽 / 实测宽。放在第二遍做，因为要先上屏才能量。
  for (const { el, width } of pending) {
    const w = el.getBoundingClientRect().width
    if (w > 1 && width > 1) el.style.transform = `scaleX(${(width / w).toFixed(4)})`
  }
}

/** 上一次已经发出去的选区（`页:文本`），用于去重 */
let lastSelKey = ''

/**
 * 原页划词结束。
 *
 * 只认「起点落在选区层里」的选区 —— 正文段落上的选区也会冒泡到 window，
 * 不判归属就会把正文选中当成原页选中，弹两次工具条。
 *
 * 桌面走 mouseup，触摸屏没有 —— 长按选中由浏览器创建，只能靠 selectionchange
 * 通知。两条路都汇到这里，用 lastSelKey 去掉重复触发。
 */
function onSelectionEnd() {
  setTimeout(() => {
    const host = textEl.value
    const sel = typeof window !== 'undefined' ? window.getSelection() : null
    if (!host || !sel || sel.isCollapsed || !sel.rangeCount) return
    if (!sel.anchorNode || !host.contains(sel.anchorNode)) return

    const raw = sel.toString()
    const text = raw.replace(/[\u00ad\u00ac]/g, '').replace(/\s+/g, ' ').trim()
    if (text.length < 2 || text.length > 4000) return
    const key = `${pageNum.value}:${text}`
    if (key === lastSelKey) return
    lastSelKey = key

    const vp = lastVp
    const stage = host.getBoundingClientRect()
    const range = sel.getRangeAt(0)
    const boxes = Array.from(range.getClientRects()).filter((b) => b.width > 1 && b.height > 1)
    if (!vp || !boxes.length) return

    const rects: PdfRect[] = boxes.map((b) => {
      // 视口坐标 → PDF 用户空间。上沿给 y_top、下沿给 y_bottom，
      // 再按「基线 = 下沿 + 0.2 行高」换算回 buildHighlights 的约定，
      // 两边必须是同一套，否则新标记会比自己画出来的高亮矮一截
      const [x1, yTop] = vp.convertToPdfPoint(b.left - stage.left, b.top - stage.top)
      const [x2, yBot] = vp.convertToPdfPoint(b.right - stage.left, b.bottom - stage.top)
      const h = Math.max(1, yTop - yBot)
      return {
        p: pageNum.value,
        x: +Math.min(x1, x2).toFixed(2),
        y: +(yBot + h * 0.2).toFixed(2),
        w: +Math.abs(x2 - x1).toFixed(2),
        h: +h.toFixed(2),
      }
    })

    emit('select-text', {
      page: pageNum.value,
      text,
      rects: mergeLineRects(rects),
      clientRect: {
        left: range.getBoundingClientRect().left,
        top: range.getBoundingClientRect().top,
        right: range.getBoundingClientRect().right,
        bottom: range.getBoundingClientRect().bottom,
      },
    })
  }, 10)
}

/** 同一行上的多个框合并成一条，否则一个短语会画出一串小方块 */
function mergeLineRects(rects: PdfRect[]): PdfRect[] {
  const sorted = [...rects].sort((a, b) => a.p - b.p || b.y - a.y || a.x - b.x)
  const out: PdfRect[] = []
  for (const r of sorted) {
    const cur = out[out.length - 1]
    if (
      cur && cur.p === r.p
      && Math.abs(r.y - cur.y) <= Math.max(2, cur.h * 0.45)
      && r.x - (cur.x + cur.w) <= Math.max(12, cur.h * 1.4)
      && r.x >= cur.x - 1
    ) {
      const right = Math.max(cur.x + cur.w, r.x + r.w)
      cur.w = +(right - cur.x).toFixed(2)
      cur.h = Math.max(cur.h, r.h)
    } else {
      out.push({ ...r })
    }
  }
  return out
}

/** 原页上刚建好的标记：本地补一份矩形，立刻就能看到高亮 */
function addMarkRects(markId: string, rects: PdfRect[]) {
  if (!markId || !rects?.length) return
  localRects.value = { ...localRects.value, [markId]: rects }
  if (lastVp) buildHighlights(lastVp)
}

/**
 * 在原页上给一句提示。
 *
 * 划词建标记失败时**必须**说一句：调用方在画布上方，页面级提示条被浮层挡住，
 * 用户看到的就是「选了字、点了按钮，什么都没发生」。
 */
function notify(msg: string) {
  status.value = msg
  setTimeout(() => { if (status.value === msg) status.value = '' }, 2600)
}

defineExpose({ addMarkRects, notify })

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

// 触摸屏没有 mouseup：长按选中是浏览器自己建的，只能靠 selectionchange 通知。
// 桌面端不挂这个监听 —— 拖选过程中它会连续触发，工具条跟着抖。
const IS_TOUCH = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches
let selTimer: any = null
function onDocSelectionChange() {
  if (!props.open || !IS_TOUCH) return
  clearTimeout(selTimer)
  selTimer = setTimeout(() => onSelectionEnd(), 260)
}
onMounted(() => { if (IS_TOUCH) document.addEventListener('selectionchange', onDocSelectionChange) })
onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', onDocSelectionChange)
  clearTimeout(selTimer)
})
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

/* 选区层：文字透明，只为了让浏览器有可选择的文本节点。
   容器不吃指针事件（否则挡住高亮框的 hover 和 title），
   单个 span 吃 —— 用户必须能在字上按下鼠标开始拖选。 */
.pdfv-text {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  user-select: text;
  line-height: 1;
  z-index: 2;
}
/* span 是 JS 建的，拿不到 scoped 的 data-v 属性，必须用 :deep 穿透 ——
   写 `.pdfv-text span` 会编译成 `.pdfv-text span[data-v-x]`，一条都命中不了，
   文字会以普通行内流显示成一大段黑字，压在画面上 */
.pdfv-text :deep(span) {
  position: absolute;
  white-space: pre;
  color: transparent;
  transform-origin: 0 0;
  pointer-events: auto;
  cursor: text;
}
.pdfv-text ::selection { background: rgba(59, 130, 246, 0.34); }

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
