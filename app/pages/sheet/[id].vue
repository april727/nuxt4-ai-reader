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

      <div class="tb-right">
        <div class="tool-group">
          <button class="tool" :class="{ on: tool === 'pan' }" title="平移（V）" @click="tool = 'pan'">平移</button>
          <button class="tool" :class="{ on: tool === 'box' }" title="框选（B）" @click="tool = 'box'">框选</button>
        </div>
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
        <span class="save-state" :class="saveState">{{ saveText }}</span>
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
          @create="onCreate"
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
          @select="selectedId = $event"
          @remove="onRemove"
          @set-kind="onSetKind"
          @set-note="onSetNote"
          @goto="onGoto"
        />
      </aside>
    </div>

    <div v-if="loading" class="sheet-loading">加载中…</div>
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
const tool = ref<'pan' | 'box'>('pan')
const defaultKind = ref('key')
const loading = ref(true)
const panelW = ref(368)
const canvasRef = ref<any>(null)

const kinds = SHEET_KINDS

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
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('beforeunload', flushSave)
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
  else if (e.key === 'Escape') selectedId.value = undefined
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
.tool.on { background: #fff; color: #3d3591; box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.08); }
.kind-pick.on { background: #fff; }
.save-state { font-size: 11px; color: #a09e97; min-width: 42px; text-align: right; }
.save-state.saved { color: #0f6e56; }
.save-state.error { color: #a32d2d; }

.sheet-body { display: flex; flex: 1; overflow: hidden; }
.sheet-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

.sheet-loading {
  position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(247, 246, 243, 0.8); font-size: 13px; color: #8a8880;
}

@media (max-width: 720px) {
  .kind-group { display: none; }
  .reader-panel { display: none; }
}
</style>
