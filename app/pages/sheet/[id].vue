<template>
  <div class="sheet-app">
    <header class="sheet-topbar">
      <div class="tb-left">
        <button class="tb-icon" title="返回" @click="goBack">←</button>
        <input v-model="title" class="tb-title" spellcheck="false" @change="saveTitle" />
      </div>

      <div class="tb-center">
        <template v-if="pages.length > 1">
          <button class="tb-icon sm" :disabled="pageIdx <= 0" @click="goPage(pageIdx - 1)">‹</button>
          <span class="tb-page">{{ pageIdx + 1 }} / {{ pages.length }}</span>
          <button class="tb-icon sm" :disabled="pageIdx >= pages.length - 1" @click="goPage(pageIdx + 1)">›</button>
        </template>
        <span v-else-if="pages.length" class="tb-page">单页</span>
      </div>

      <!-- 手机上工具栏塞不下：主功能收进这里（桌面隐藏，见 .more-wrap 样式） -->
      <div class="more-wrap">
        <button class="tb-icon more-btn" title="更多（AI 切题 / 错题本）" @click.stop="moreMenu = !moreMenu">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
          </svg>
        </button>
        <div v-if="moreMenu" class="more-menu" @click.stop>
          <button class="more-item" :disabled="aiRunning" @click="moreAi('page')">
            <span class="more-ico">✦</span>AI 切题 · 当前页
          </button>
          <button v-if="pages.length > 1" class="more-item" :disabled="aiRunning" @click="moreAi('all')">
            <span class="more-ico">✦</span>AI 切题 · 全部 {{ pages.length }} 页
          </button>
          <div class="more-sep"></div>
          <NuxtLink class="more-item" to="/sheet/wrong">
            <span class="more-ico">✎</span>试卷错题本
          </NuxtLink>
        </div>
      </div>

      <div class="tb-right">
        <div class="tool-group">
          <button class="tool" :class="{ on: tool === 'pan' }" title="平移（V）" @click="tool = 'pan'">
            <svg class="tool-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 4.5v15M4.5 12h15" />
              <path d="M9.6 6.9 12 4.5l2.4 2.4M9.6 17.1 12 19.5l2.4-2.4M6.9 9.6 4.5 12l2.4 2.4M17.1 9.6 19.5 12l-2.4 2.4" />
            </svg><span class="tool-txt">平移</span>
          </button>
          <button class="tool" :class="{ on: tool === 'box' }" title="框选（B）" @click="tool = 'box'">
            <svg class="tool-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2" stroke-dasharray="3.2 2.4" />
            </svg><span class="tool-txt">框选</span>
          </button>
          <button class="tool" :class="{ on: tool === 'cover' }" title="遮答案（C）：框住答案区，复习时盖上" @click="tool = 'cover'">
            <svg class="tool-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M2.6 12S6.1 5.9 12 5.9 21.4 12 21.4 12 17.9 18.1 12 18.1 2.6 12 2.6 12Z" />
              <circle cx="12" cy="12" r="2.7" />
              <path d="M4.2 19.8 19.8 4.2" />
            </svg><span class="tool-txt">遮答案</span>
          </button>
        </div>
        <button
          v-if="coverTotal"
          class="answer-toggle"
          :class="{ on: answersVisible }"
          :title="answersVisible ? '当前显示答案，点击盖上' : '当前已遮挡，点击临时全显'"
          @click="answersVisible = !answersVisible"
        >
          <span class="ans-full">{{ answersVisible ? '显示答案' : `答案已遮 ${coverTotal}` }}</span>
          <span class="ans-short">{{ answersVisible ? '已显示' : `已遮 ${coverTotal}` }}</span>
        </button>
        <div class="kind-group">
          <button
            v-for="m in kinds"
            :key="m.k"
            class="kind-pick"
            :class="{ on: defaultKind === m.k }"
            :style="defaultKind === m.k ? { borderColor: m.color, color: m.color, background: m.wash } : {}"
            :title="`框选后默认存为「${m.label}」`"
            @click="defaultKind = m.k"
          >{{ m.label }}</button>
        </div>
        <!-- 手机上五个彩色按钮占掉半行，换成系统下拉（原生 picker，触屏更好点） -->
        <select
          v-model="defaultKind"
          class="kind-select"
          :style="{ color: curKind.color, borderColor: curKind.color }"
          title="框选后默认存为"
        >
          <option v-for="m in kinds" :key="m.k" :value="m.k">{{ m.label }}</option>
        </select>
        <div class="ai-wrap">
          <button class="tool ai-btn" :disabled="aiRunning" @click="aiMenu = !aiMenu" :title="aiRunning ? 'AI 正在切题…' : 'AI 自动切题（本地图直传模型）'">
            {{ aiRunning ? '切题中…' : 'AI 切题' }}
          </button>
          <div v-if="aiMenu" class="ai-menu">
            <button @click="runAutoTag('page')">只切当前页</button>
            <button v-if="pages.length > 1" @click="runAutoTag('all')">全部 {{ pages.length }} 页</button>
          </div>
        </div>
        <NuxtLink class="tb-link" to="/sheet/wrong" title="试卷错题本（按间隔重复复习）">错题本</NuxtLink>
        <span class="save-state" :class="saveState" :title="saveText || '已保存'"><i class="save-dot"></i><span class="save-txt">{{ saveText }}</span></span>
      </div>
    </header>

    <div class="sheet-body">
      <div class="sheet-main">
        <SheetCanvas
          ref="canvasRef"
          :page="currentPage"
          :annotations="annotations"
          :tool="tool"
          :selected-id="selectedId"
          :answers-visible="answersVisible"
          @create="onCreate"
          @create-cover="onCreateCover"
          @select="onSelectBox"
          @ready="onCanvasReady"
        />
      </div>

      <div class="panel-divider" @mousedown.prevent="startResize"></div>

      <aside class="reader-panel" :style="{ width: panelW + 'px' }">
        <SheetPanel
          :annotations="annotations"
          :pages="pages"
          :selected-id="selectedId"
          :covers="currentPage?.covers || []"
          :page-no="pageIdx + 1"
          @select="selectedId = $event"
          @remove="onRemove"
          @set-kind="onSetKind"
          @set-note="onSetNote"
          @goto="onGoto"
          @remove-cover="onRemoveCover"
          @focus-cover="onFocusCover"
        />
      </aside>
    </div>

    <div v-if="loading" class="sheet-loading">加载中…</div>

    <!-- AI 切题结果确认：误判很正常，先看一眼再决定是否落库 -->
    <div v-if="aiPreview" class="ai-bar">
      <span class="ai-bar-text">
        AI 识别出 <strong>{{ aiPreview.count }}</strong> 道题
        <span v-if="aiPreview.failed" class="ai-bar-warn">· {{ aiPreview.failed }} 页失败</span>
      </span>
      <button class="ai-bar-ok" @click="commitAutoTag">写入</button>
      <button class="ai-bar-cancel" @click="aiPreview = null">取消</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type { SheetPage, SheetAnno, SheetBBox } from '~/utils/sheetTypes'
import { SHEET_KINDS } from '~/utils/sheetTypes'

const route = useRoute()
const id = String(route.params.id)

const title = ref('')
const pages = ref<SheetPage[]>([])
const annotations = ref<SheetAnno[]>([])
const activePageId = ref('')
const selectedId = ref<string | undefined>()
const tool = ref<'pan' | 'box' | 'cover'>('pan')
const defaultKind = ref('key')
/** 顶栏「显示答案」：开着时不渲染遮挡块（临时核对答案用，不落盘） */
const answersVisible = ref(false)
const coverTotal = computed(() =>
  pages.value.reduce((s, p) => s + (Array.isArray(p.covers) ? p.covers.length : 0), 0),
)
const loading = ref(true)
const panelW = ref(368)
const canvasRef = ref<any>(null)

const kinds = SHEET_KINDS
/** 手机下拉框的当前色（跟着默认类型走，让选择器本身也能当颜色图例） */
const curKind = computed(() => kinds.find(k => k.k === defaultKind.value) || kinds[0])

const pageIdx = computed(() => Math.max(0, pages.value.findIndex(p => p.id === activePageId.value)))
const currentPage = computed(() => pages.value[pageIdx.value] || null)

// ── 读取 ──
/**
 * 预取其余页面的图（本地磁盘 + immutable 缓存，代价很低）。
 * 不做预取的话，翻页时才开始下载，多页试卷每翻一页都要等一次空白。
 */
function prefetchPages() {
  for (const p of pages.value) {
    if (!p?.url) continue
    const img = new Image()
    img.decoding = 'async'
    img.src = p.url
  }
}

onMounted(async () => {
  try {
    const row = await $fetch<any>(`/api/text/${id}`)
    if (row.contentKind !== 'sheet') {
      await navigateTo(`/read/${id}`, { replace: true })
      return
    }
    title.value = row.title || ''
    pages.value = Array.isArray(row.segments) ? row.segments : []
    annotations.value = Array.isArray(row.annotations) ? row.annotations : []
    activePageId.value = pages.value[0]?.id || ''
    // 深链：错题本「在试卷里打开」会带 page / box，直接落到那道题上
    const qPage = String(route.query.page || '')
    const qBox = String(route.query.box || '')
    const qAnno = qBox ? annotations.value.find(a => a.id === qBox) : null
    if (qAnno) {
      selectedId.value = qAnno.id
      pendingFocus = qAnno
      activePageId.value = qAnno.pageId
    } else if (qPage && pages.value.some(p => p.id === qPage)) {
      activePageId.value = qPage
    }
    prefetchPages()
  } catch {
    // 保持在空态，用户可以返回
  } finally {
    loading.value = false
    await nextTick()
    // 初次载入不应触发自动保存
    setTimeout(() => { suppressSave = false }, 300)
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('beforeunload', flushSave)
  document.addEventListener('click', onDocClick)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('beforeunload', flushSave)
  document.removeEventListener('click', onDocClick)
  flushSave()
})

// ── 保存（防抖整体覆盖）──
let suppressSave = true
let saveTimer: ReturnType<typeof setTimeout> | null = null
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')

const saveText = computed(() => {
  if (saveState.value === 'saving') return '保存中'
  if (saveState.value === 'saved') return '已保存'
  if (saveState.value === 'error') return '保存失败'
  return ''
})

watch(annotations, () => {
  if (suppressSave) return
  saveState.value = 'saving'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(doSave, 500)
}, { deep: true })

async function doSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  try {
    await $fetch(`/api/sheet/${id}/annotations`, {
      method: 'POST',
      body: { annotations: annotations.value },
    })
    saveState.value = 'saved'
  } catch {
    saveState.value = 'error'
  }
}

function flushSave() {
  if (saveState.value === 'saving') void doSave()
}

async function saveTitle() {
  try {
    await $fetch('/api/text/update', { method: 'POST', body: { id, title: title.value } })
  } catch {}
}

// ── 标注操作 ──
function onCreate(bbox: { x: number; y: number; w: number; h: number }) {
  const a: SheetAnno = {
    id: `an_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    pageId: activePageId.value,
    kind: defaultKind.value,
    bbox,
    note: '',
    createdAt: new Date().toISOString(),
  }
  annotations.value = [...annotations.value, a]
  selectedId.value = a.id
}

function onSelectBox(boxId: string) {
  selectedId.value = boxId
}

// ── 答案遮挡区（页级，存在 segments 的 page 上）──
/**
 * 只改了当前页的 covers，存库走独立接口（mutateSegments + CAS）。
 * 不能搭 annotations 的顺风车：两者是不同字段，整体覆盖会把页结构冲掉。
 */
function onCreateCover(bbox: SheetBBox) {
  const idx = pageIdx.value
  const p = pages.value[idx]
  if (!p) return
  const covers = [...(p.covers || []), bbox]
  pages.value[idx] = { ...p, covers }
  void saveCovers(p.id, covers)
  answersVisible.value = false // 刚画完就显形会让人以为没画上
}

function onRemoveCover(ci: number) {
  const idx = pageIdx.value
  const p = pages.value[idx]
  if (!p) return
  const covers = (p.covers || []).filter((_, k) => k !== ci)
  pages.value[idx] = { ...p, covers }
  void saveCovers(p.id, covers)
}

function onFocusCover(ci: number) {
  const b = currentPage.value?.covers?.[ci]
  if (b) canvasRef.value?.focusOn?.(b)
}

async function saveCovers(pageId: string, covers: SheetBBox[]) {
  saveState.value = 'saving'
  try {
    await $fetch(`/api/sheet/${id}/covers`, { method: 'POST', body: { pageId, covers } })
    saveState.value = 'saved'
  } catch {
    saveState.value = 'error'
  }
}

function onRemove(boxId: string) {
  annotations.value = annotations.value.filter(a => a.id !== boxId)
  if (selectedId.value === boxId) selectedId.value = undefined
}

function onSetKind(boxId: string, kind: string) {
  annotations.value = annotations.value.map(a => (a.id === boxId ? { ...a, kind } : a))
}

function onSetNote(boxId: string, note: string) {
  annotations.value = annotations.value.map(a => (a.id === boxId ? { ...a, note } : a))
}

// ── 定位 ──
let pendingFocus: SheetAnno | null = null

function onGoto(pageId: string, boxId: string) {
  const target = annotations.value.find(a => a.id === boxId)
  if (!target) return
  selectedId.value = boxId
  if (pageId !== activePageId.value) {
    pendingFocus = target
    activePageId.value = pageId
  } else {
    canvasRef.value?.focusOn?.(target.bbox)
  }
}

function onCanvasReady() {
  if (pendingFocus) {
    const b = pendingFocus.bbox
    pendingFocus = null
    nextTick(() => canvasRef.value?.focusOn?.(b))
  }
}

// ── 页码 ──
function goPage(idx: number) {
  const p = pages.value[idx]
  if (p) {
    activePageId.value = p.id
    selectedId.value = undefined
  }
}

// ── AI 自动切题 ──
const aiMenu = ref(false)
/** 手机上「更多」菜单（桌面不渲染这个按钮，菜单项也都藏起来） */
const moreMenu = ref(false)

/** 菜单项的 AI 切题：先收起菜单再跑，否则 loading 态被菜单盖住看不见 */
function moreAi(scope: 'page' | 'all') {
  moreMenu.value = false
  void runAutoTag(scope)
}

function closeMenus() {
  moreMenu.value = false
  aiMenu.value = false
}

/**
 * 点空白处收起「更多」菜单。
 *
 * 菜单容器与触发按钮都带 @click.stop，这里只会收到「点到了别处」的事件；
 * 仍判一次 closest 是给将来往菜单里塞没有 stop 的元素留保险。
 */
function onDocClick(e: MouseEvent) {
  if (!moreMenu.value) return
  const t = e.target as HTMLElement | null
  if (!t?.closest?.('.more-wrap')) moreMenu.value = false
}
const aiRunning = ref(false)
const aiPreview = ref<{
  count: number
  failed: number
  pages: Array<{ pageId: string; regions: Array<{ no: string; label: string; bbox: SheetBBox }> }>
} | null>(null)

async function runAutoTag(scope: 'page' | 'all') {
  aiMenu.value = false
  if (aiRunning.value) return
  aiRunning.value = true
  try {
    const pageIds = scope === 'page'
      ? [activePageId.value]
      : pages.value.map(p => p.id)
    const res = await $fetch<any>(`/api/sheet/${id}/auto-tag`, {
      method: 'POST',
      body: { pageIds },
    })
    const list = Array.isArray(res?.pages) ? res.pages : []
    const failed = list.filter((p: any) => !p.regions?.length).length
    const count = list.reduce((s: number, p: any) => s + (p.regions?.length || 0), 0)
    if (!count) {
      alert(failed ? 'AI 没认出题目（可看下服务端日志）' : '这一页没有识别到题目')
      return
    }
    aiPreview.value = { count, failed, pages: list }
  } catch (e: any) {
    alert(e?.data?.message || 'AI 切题失败')
  } finally {
    aiRunning.value = false
  }
}

/**
 * 写入题目区：先清掉该页原有的「题目」标注再写新的。
 * 不清的话，同一页连点两次会得到两套重叠框，删起来很烦。
 */
function commitAutoTag() {
  const pv = aiPreview.value
  if (!pv) return
  const touched = new Set(pv.pages.map(p => p.pageId))
  const kept = annotations.value.filter(a => !(a.kind === 'q' && touched.has(a.pageId)))
  const stamp = Date.now()
  const added: SheetAnno[] = []
  for (const p of pv.pages) {
    p.regions.forEach((r, i) => {
      added.push({
        id: `an_${stamp}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        pageId: p.pageId,
        kind: 'q',
        bbox: r.bbox,
        note: [r.no, r.label].filter(Boolean).join(' · '),
        createdAt: new Date().toISOString(),
      })
    })
  }
  annotations.value = [...kept, ...added]
  aiPreview.value = null
  // 切完直接能改类型：把工具切回框选，避免用户还停在平移以为框不动
  tool.value = 'box'
}

// ── 面板宽度 ──
function startResize(e: MouseEvent) {
  const startX = e.clientX
  const startW = panelW.value
  const move = (ev: MouseEvent) => {
    panelW.value = Math.min(680, Math.max(240, startW - (ev.clientX - startX)))
  }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

// ── 键盘 ──
function onKey(e: KeyboardEvent) {
  const el = e.target as HTMLElement
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
  if (e.key === 'v' || e.key === 'V') tool.value = 'pan'
  else if (e.key === 'b' || e.key === 'B') tool.value = 'box'
  else if (e.key === 'c' || e.key === 'C') tool.value = 'cover'
  else if (e.key === 'a' || e.key === 'A') answersVisible.value = !answersVisible.value
  else if (e.key === 'Escape') { selectedId.value = undefined; closeMenus() }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId.value) {
    e.preventDefault()
    onRemove(selectedId.value)
  } else if (e.key === 'ArrowRight' && pages.value.length > 1) goPage(pageIdx.value + 1)
  else if (e.key === 'ArrowLeft' && pages.value.length > 1) goPage(pageIdx.value - 1)
}

function goBack() {
  // 试卷是书架里的一本书，返回到它所在的文件夹（默认文件夹 = 首页），
  // 不回资源页——资源页是词库/资源，跟试卷不属于同一条路径
  const folder = (route.query.folder as string) || 'default'
  navigateTo(folder && folder !== 'default' ? `/?folder=${encodeURIComponent(folder)}` : '/')
}
</script>

<style scoped>
.sheet-app {
  display: flex; flex-direction: column; height: 100vh;
  font-family: 'DM Sans', sans-serif; background: #f7f6f3; color: #1a1a18;
}
.sheet-topbar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 0 14px; height: 50px; flex-shrink: 0;
  border-bottom: 0.5px solid rgba(0, 0, 0, 0.08); background: #fff;
}
.tb-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
.tb-icon {
  border: 0.5px solid rgba(0, 0, 0, 0.12); background: transparent;
  width: 26px; height: 26px; border-radius: 7px; cursor: pointer;
  font-size: 13px; color: #4a4843; flex-shrink: 0; line-height: 1;
}
.tb-icon:hover { background: #f5f4f0; }
.tb-icon.sm { width: 22px; height: 22px; font-size: 14px; }
.tb-icon:disabled { opacity: 0.35; cursor: default; }
.tb-title {
  border: none; background: transparent; outline: none;
  font-family: 'Lora', Georgia, serif; font-size: 14.5px; font-weight: 500;
  color: #1a1a18; min-width: 60px; width: 100%; max-width: 320px;
  padding: 3px 5px; border-radius: 6px;
}
.tb-title:hover { background: #f7f6f3; }
.tb-title:focus { background: #f7f6f3; }

.tb-center { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.tb-page { font-size: 11.5px; color: #8a8880; font-variant-numeric: tabular-nums; }

.tb-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.tool-group, .kind-group { display: flex; gap: 2px; background: #f2f0ec; border-radius: 8px; padding: 2px; }
.tool, .kind-pick {
  border: none; background: transparent; cursor: pointer;
  font-family: 'DM Sans', sans-serif; font-size: 11.5px; color: #6b6862;
  padding: 4px 9px; border-radius: 6px;
}
/* 工具按钮：桌面显示文字，手机只留图标（见 @media 段） */
.tool {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
}
.tool-ico { display: none; width: 15px; height: 15px; flex-shrink: 0; }
.tool.on { background: #fff; color: #3d3591; box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.08); }
.kind-pick.on { background: #fff; }
.answer-toggle {
  border: 0.5px solid rgba(0, 0, 0, 0.14); background: #fff; cursor: pointer;
  font-family: 'DM Sans', sans-serif; font-size: 11.5px; color: #6b6862;
  padding: 4px 9px; border-radius: 7px; white-space: nowrap;
}
.answer-toggle:hover { border-color: rgba(61, 53, 145, 0.4); color: #3d3591; }
.answer-toggle.on { background: #edeafd; border-color: rgba(61, 53, 145, 0.25); color: #3d3591; }
.tb-link {
  font-size: 11.5px; color: #6b6862; text-decoration: none;
  border: 0.5px solid rgba(0, 0, 0, 0.12); border-radius: 7px; padding: 4px 9px;
  white-space: nowrap;
}
.tb-link:hover { border-color: rgba(61, 53, 145, 0.4); color: #3d3591; }

.ai-wrap { position: relative; }
.ai-btn {
  border: 0.5px solid rgba(61, 53, 145, 0.28); background: #f6f5ff; color: #3d3591;
  border-radius: 7px; padding: 4px 9px; cursor: pointer; font-size: 11.5px;
  font-family: 'DM Sans', sans-serif; white-space: nowrap;
}
.ai-btn:hover { background: #edeafd; }
.ai-btn:disabled { opacity: 0.6; cursor: default; }
.ai-menu {
  position: absolute; top: calc(100% + 5px); right: 0; z-index: 30;
  background: #fff; border: 0.5px solid rgba(0, 0, 0, 0.14); border-radius: 9px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); padding: 4px; min-width: 128px;
}
.ai-menu button {
  display: block; width: 100%; text-align: left;
  border: none; background: transparent; cursor: pointer;
  font-family: 'DM Sans', sans-serif; font-size: 12px; color: #4a4843;
  padding: 7px 9px; border-radius: 6px;
}
.ai-menu button:hover { background: #f5f4f0; color: #3d3591; }

.ai-bar {
  position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px; z-index: 60;
  background: #1f1f1d; color: #fff; border-radius: 11px;
  padding: 10px 14px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
  font-size: 12.5px;
}
.ai-bar-text strong { font-weight: 600; }
.ai-bar-warn { color: #e5b96a; margin-left: 6px; }
.ai-bar-ok {
  border: none; background: #6d68d8; color: #fff; cursor: pointer;
  border-radius: 7px; padding: 5px 13px; font-size: 12px; font-family: inherit;
}
.ai-bar-ok:hover { background: #5f5ad0; }
.ai-bar-cancel {
  border: none; background: transparent; color: #b9b7b0; cursor: pointer;
  font-size: 12px; font-family: inherit; padding: 5px 6px;
}
.ai-bar-cancel:hover { color: #fff; }
.save-state { font-size: 11px; color: #a09e97; min-width: 42px; text-align: right; }
.save-state.saved { color: #0f6e56; }
.save-state.error { color: #a32d2d; }
.save-dot { display: none; }

/* ── 手机上才出现的收口件（桌面全部隐藏）── */
.more-wrap { display: none; position: relative; flex-shrink: 0; }
.more-btn {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0;
}
.more-btn svg { width: 16px; height: 16px; }
.more-menu {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 40;
  min-width: 158px; padding: 4px;
  background: #fff; border: 0.5px solid rgba(0, 0, 0, 0.14); border-radius: 10px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.14);
}
.more-item {
  display: flex; align-items: center; gap: 7px; width: 100%;
  border: none; background: transparent; cursor: pointer;
  font-family: 'DM Sans', sans-serif; font-size: 12.5px; color: #3f3d38;
  padding: 9px 10px; border-radius: 7px; text-decoration: none;
  white-space: nowrap; text-align: left;
}
.more-item:hover { background: #f5f4f0; color: #3d3591; }
.more-item:disabled { opacity: 0.5; cursor: default; }
.more-ico { font-size: 11px; color: #8a8880; width: 12px; text-align: center; }
.more-sep { height: 1px; margin: 4px 6px; background: rgba(0, 0, 0, 0.07); }

/* 手机的类型选择：五个彩色按钮横向占满半行，换成原生下拉 */
.kind-select {
  display: none; font-family: 'DM Sans', sans-serif; font-size: 11.5px;
  padding: 3px 4px; border-radius: 7px; border: 0.5px solid rgba(0, 0, 0, 0.14);
  background: #fff; max-width: 78px;
}
.ans-short { display: none; }

.sheet-body { display: flex; flex: 1; overflow: hidden; }
.sheet-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

.sheet-loading {
  position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(247, 246, 243, 0.8); font-size: 13px; color: #8a8880;
}

/**
 * 手机：顶栏折成两行。
 *
 * 原先所有控件挤在一行（返回 + 标题 + 页码 + 三个工具 + 答案开关 + AI + 错题本 + 保存状态），
 * 合计约 520px，窄屏下溢出：页码块被挤到标题上叠成「第五单页」，最后几项直接出屏；
 * 更要命的是溢出让文档宽度变成 435，画布按 435 算 fitWidth，试卷右侧那列题号被裁掉。
 * 所以这里必须换行，而不是缩小字号或隐藏按钮。
 */
@media (max-width: 720px) {
  .sheet-app { overflow: hidden; }
  .sheet-topbar {
    flex-wrap: wrap; height: auto;
    padding: 6px 10px; row-gap: 6px; column-gap: 8px;
  }
  /* flex-basis 必须给 0：用 auto 时标题的「内容宽度」参与换行计算，
     320px 屏上会把页码整块挤到下一行，白占 30px 高度 */
  .tb-left { flex: 1 1 0; min-width: 0; }
  /* 16px 是 iOS 不自动放大的下限，14.5px 会让整页在聚焦标题时被推着缩放 */
  /* min-width:0 必须给：input 的 min-content 宽度由 size 属性（默认 20 字符）决定，
     不压掉它，320px 屏上标题会把页码挤到第三行 */
  .tb-title { max-width: none; min-width: 0; font-size: 16px; padding: 2px 4px; }
  .tb-right {
    flex: 1 1 100%; flex-wrap: wrap;
    justify-content: flex-start; row-gap: 6px; column-gap: 6px;
  }
  /* 工具整组不能压扁：压扁后「遮答案」会变成竖排两个字，看着像乱码 */
  .tb-right > * { flex-shrink: 0; }

  /* 页码是第一行唯一的状态信息，窄屏上不能淡到看不见 */
  .tb-page { font-size: 12px; color: #5f5d57; }
  .tb-icon.sm { width: 26px; height: 26px; }

  /* 收口：AI 切题与错题本进「更多」菜单，工具只留图标，类型换下拉，保存状态换圆点 */
  .more-wrap { display: block; }
  .ai-wrap, .tb-link, .kind-group { display: none; }
  .kind-select { display: inline-block; }
  .tool { padding: 6px 9px; }
  .tool-ico { display: block; }
  .tool-txt { display: none; }
  .ans-full { display: none; }
  .ans-short { display: inline; }

  .save-state { margin-left: auto; min-width: 0; text-align: center; }
  .save-txt { display: none; }
  .save-dot {
    display: block; width: 9px; height: 9px; border-radius: 50%;
    background: transparent; transition: background 0.2s;
  }
  .save-state.saved .save-dot { background: #0f6e56; }
  .save-state.saving .save-dot { background: #ba7517; animation: dot-pulse 1s ease-in-out infinite; }
  .save-state.error .save-dot { background: #a32d2d; }

  .reader-panel { display: none; }
  .panel-divider { display: none; }
}

@keyframes dot-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }

/* 320~360 的老机型再收一档，让工具条留在同一行，不因换行把顶栏撑到 80px */
@media (max-width: 360px) {
  /* .tool 不在这一档：它已经是图标按钮，再压内边距会低于触摸目标可点尺寸 */
  .kind-pick, .tb-link, .ai-btn, .answer-toggle { font-size: 11px; padding: 3px 7px; }
  .tb-right { column-gap: 4px; }
}
</style>
