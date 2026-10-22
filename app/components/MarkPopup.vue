<template>
  <Teleport to="body">
    <div v-if="visible" class="mark-popup" :style="popupStyle" ref="popupRef">
      <div class="mp-header" :style="{ background: mark.color }" @mousedown="startDrag" @touchstart.stop="startDragTouch">
        <span class="mp-type">{{ typeLabel }}</span>
        <div class="mp-header-actions">
          <button class="mp-btn-icon mp-delete" @click.stop="handleDelete" title="删除"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
          <button class="mp-btn-icon mp-expand-btn" @click.stop="toggleExpand">
            <svg class="mp-chevron" :class="{ open: expanded }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <button class="mp-btn-icon mp-close-btn" @click.stop="close">×</button>
        </div>
      </div>
      <div v-if="expanded" class="mp-body">
        <div v-if="(loading || typing) && !typingContent" class="mp-loading"><div class="spinner-sm"></div>AI 正在生成解释…</div>

        <!-- 编辑 / 显示 切换 + AI 生成 -->
        <div class="mp-tabs">
          <button class="mp-tab" :class="{ active: viewTab === 'edit' }" @click="switchTab('edit')">编辑</button>
          <button class="mp-tab" :class="{ active: viewTab === 'view' }" @click="switchTab('view')">显示</button>
          <div class="mp-auto-toggle" title="标记后是否自动生成解释">
            <button :class="{ active: autoGenerate }" @click.stop="emit('update-auto-generate', true)">自动</button>
            <button :class="{ active: !autoGenerate }" @click.stop="emit('update-auto-generate', false)">手动</button>
          </div>
          <button class="mp-ai-btn" :disabled="loading || typing" @click="emit('generate')" title="AI 生成解释内容">
            <svg v-if="loading || typing" class="spinner-xs" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6l2.1 2.1m0-12.8l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>
          </button>
          <button class="mp-ai-btn mp-img-trigger" @click="openImagePicker" title="为这个词配一张图">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2.5"/>
              <circle cx="8.5" cy="9.5" r="1.6"/>
              <path d="M21 16l-5-5-6 7"/>
            </svg>
          </button>
        </div>

        <div class="mp-word-row" :style="{ borderLeftColor: mark.color }">
          <span class="mp-word-text">{{ mark.text }}<span v-if="mark.lemma && mark.lemma !== mark.text" class="mp-lemma">({{ mark.lemma }})</span></span>
          <template v-if="mark.type === 'word'">
            <span v-if="phonetic" class="mp-phonetic">{{ phonetic }}</span>
            <button class="mp-play-btn" :class="{ playing: isPlaying }" @click="doPronounce"><span v-if="isPlaying" class="playing-bars"><span></span><span></span><span></span></span><svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></button>
          </template>
        </div>

        <!-- 自动配图改为独立弹窗，见页面底部 Teleport -->

        <!-- 编辑模式：可手动填写内容 -->
        <div v-if="viewTab === 'edit'" class="mp-edit-area">
          <textarea
            ref="editDetailEl"
            v-model="editDetail"
            class="mp-edit-input"
            spellcheck="false"
            placeholder="粘贴或手写解释内容（支持 Markdown，可直接 Ctrl+V 粘贴图片），或点「AI 生成」自动填写…"
            @paste="onEditDetailPaste"
            @blur="commitDetail"
          ></textarea>
        </div>

        <!-- 显示模式：渲染内容（流式与完成共用同一字号基准，避免文字跳动） -->
        <div v-else class="mp-detail">
          <template v-if="typing && typingContent">
            <MarkdownRenderer :content="typingContent" /><span class="tc-typing">|</span>
          </template>
          <MarkdownRenderer
            v-else
            :content="displayDetail"
            image-resizable
            @resize-image="onDetailImageResize"
          />
        </div>

        <div class="mp-note"><textarea v-model="localNote" class="mp-note-input" placeholder="笔记..." rows="2" @blur="saveNote"></textarea></div>
      </div>
      <div v-if="expanded" class="mp-resize-handle" @mousedown="startResize"></div>
    </div>
  </Teleport>

  <!-- 配图选择弹窗 -->
  <Teleport to="body">
    <div v-if="img.open" class="mp-picker-overlay" @click.self="closeImagePicker">
      <div class="mp-picker">
        <div class="mp-picker-head">
          <span class="mp-picker-title">配图</span>
          <button class="mp-picker-close" @click="closeImagePicker" aria-label="关闭">×</button>
        </div>

        <div class="mp-picker-body">
          <div class="mp-picker-search">
            <input
              v-model="img.q"
              class="mp-img-input"
              placeholder="输入检索词"
              spellcheck="false"
              @keyup.enter="searchImages()"
            />
            <button class="mp-img-go" :disabled="img.loading" @click="searchImages()">
              {{ img.loading ? '搜索中…' : '搜索' }}
            </button>
          </div>

          <div class="mp-picker-actions">
            <label class="mp-picker-upload">
              上传本地图片
              <input type="file" accept="image/*" hidden @change="onPickFile" />
            </label>
            <span class="mp-picker-tip">可直接 Ctrl+V 粘贴</span>
          </div>

          <p v-if="img.error" class="mp-img-error">{{ img.error }}</p>

          <div v-if="img.items.length" class="mp-img-grid">
            <button
              v-for="(it, i) in img.items"
              :key="it.full"
              class="mp-img-cell"
              :title="it.source"
              @click="useImage(it, i)"
            >
              <img :src="proxyUrl(it.thumb)" alt="" loading="lazy" />
            </button>
          </div>

          <p v-if="img.usedQuery" class="mp-img-hint">检索词：{{ img.usedQuery }}</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { Mark } from '#shared/types'
import { setMarkdownImageWidth } from '#shared/utils/explainRenderer'
import { compressImageFile } from '~/utils/imageCompress'

const props = defineProps<{ visible: boolean; mark: Mark; textId?: string; loading: boolean; typing: boolean; typingContent: string; position: { x: number; y: number }; autoGenerate: boolean }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'update-note', n: string): void; (e: 'delete'): void; (e: 'pronounce', w: string): void; (e: 'update-detail', d: string): void; (e: 'generate'): void; (e: 'update-auto-generate', value: boolean): void }>()

const expanded = ref(true); const localNote = ref(''); const popupX = ref(0); const popupY = ref(0); const popupW = ref(380); const popupH = ref(420); const isPlaying = ref(false)
const viewTab = ref<'edit' | 'view'>('view')
const editDetail = ref('')
const editDetailEl = ref<HTMLTextAreaElement | null>(null)
let playTimer: any = null

// ── 自动配图 ──
interface ImageCandidate { thumb: string; full: string; source: string; title?: string; license?: string }
const img = reactive({
  open: false,
  q: '',
  loading: false,
  busy: -1,
  error: '',
  usedQuery: '',
  items: [] as ImageCandidate[],
})

const phonetic = computed(() => { if (!editDetail.value) return ''; const m = editDetail.value.match(/\[PHONETIC\]\s*(\/[^/]+\/)\s*\[\/PHONETIC\]/); if (m) return m[1]; const m2 = editDetail.value.match(/\/([^/\n]{2,40})\//); return m2 ? m2[0] : '' })
const displayDetail = computed(() => { if (!editDetail.value) return ''; let d = editDetail.value; d = d.replace(/\[PHONETIC\]\s*\/[^/]+\/\s*\[\/PHONETIC\]\n?/gi, ''); d = d.replace(/###\s*音标\s*\n\s*\/[^/]+\/[^\n]*\n?/gi, ''); d = d.replace(/\[LEMMA[\s\S]*?\[\/LEMMA\]\n?/gi, ''); return d.trim() })
const typeLabel = computed(() => ({ word: '生词', phrase: '短语', sentence: '句子', note: '摘抄' } as any)[props.mark.type] || '标记')

watch(() => props.visible, (v) => {
  if (v) {
    // 弹窗宽度不得超过窗口（窄窗口/手机自动收窄），位置钳制在可视区内
    const mobile = window.innerWidth < 768
    const maxW = mobile ? Math.min(320, window.innerWidth - 16) : Math.max(280, window.innerWidth - 16)
    popupW.value = Math.min(popupW.value, maxW)
    popupX.value = Math.max(8, Math.min(props.position.x, window.innerWidth - popupW.value - 8))
    popupY.value = Math.max(8, Math.min(props.position.y, window.innerHeight - 200))
    localNote.value = props.mark.note || ''; editDetail.value = props.mark.detail || ''; viewTab.value = props.mark.detail ? 'view' : 'edit'
  }
})

// 窗口缩放时保持弹窗在可视区内
function fitPopup() {
  if (!props.visible || typeof window === 'undefined') return
  const mobile = window.innerWidth < 768
  const maxW = mobile ? Math.min(320, window.innerWidth - 16) : Math.max(280, window.innerWidth - 16)
  if (popupW.value > maxW) popupW.value = maxW
  popupX.value = Math.max(8, Math.min(popupX.value, window.innerWidth - popupW.value - 8))
  popupY.value = Math.max(8, Math.min(popupY.value, window.innerHeight - 80))
}
onMounted(() => window.addEventListener('resize', fitPopup))
onBeforeUnmount(() => window.removeEventListener('resize', fitPopup))
// AI 开始生成（首字尚未到达）→ 立即切到显示区，让骨架屏可见，避免盯着空编辑框
watch(() => props.loading || props.typing, (busy) => { if (busy && !props.typingContent) viewTab.value = 'view' })
// AI 流式输出开始 → 自动切到显示
watch(() => props.typingContent, (v) => { if (v) viewTab.value = 'view' })
// AI 生成完成 → 把 mark.detail 同步到编辑框（否则显示区仍是空）
watch(() => props.mark.detail, (v) => {
  if (v && !props.typing) editDetail.value = v
})

function switchTab(tab: 'edit' | 'view') {
  if (tab === 'view' && viewTab.value === 'edit') commitDetail()
  viewTab.value = tab
}
function commitDetail() {
  if (editDetail.value !== props.mark.detail) emit('update-detail', editDetail.value)
}

/**
 * 词语/句子解释内容编辑器：直接粘贴图片 → 上传并转成 Markdown 图片语法插入光标处。
 * 阻止冒泡，避免阅读页全局 onDocumentPaste 把图片追加到段落正文。
 */
async function onEditDetailPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (!item.type.startsWith('image/')) continue
    e.preventDefault()
    e.stopPropagation()
    const file = item.getAsFile()
    if (!file) return
    try {
      const form = new FormData()
      // 截图动辄 2–5MB，先压到最长边 1600 的 webp 再上传
      const compressed = await compressImageFile(file)
      form.append('file', compressed, (compressed as File).name || 'paste.webp')
      if (props.textId) form.append('id', props.textId)
      const result = await $fetch<{ url: string }>('/api/upload/image', { method: 'POST', body: form })
      const el = editDetailEl.value
      if (el) {
        const start = el.selectionStart ?? el.value.length
        const end = el.selectionEnd ?? start
        const md = `\n\n![图片](${result.url})\n\n`
        editDetail.value = el.value.slice(0, start) + md + el.value.slice(end)
        await nextTick()
        el.focus()
        el.setSelectionRange(start + md.length, start + md.length)
      }
    } catch (err: any) {
      alert('图片上传失败: ' + (err?.message || ''))
    }
    return
  }
}

// ── 自动配图 ──
function proxyUrl(u: string) {
  return `/api/images/proxy?url=${encodeURIComponent(u)}`
}

function openImagePicker() {
  img.open = true
  // 每次打开都以「当前标记」为准，避免沿用上一条的检索词
  img.q = (props.mark.lemma || props.mark.text || '').trim().slice(0, 40)
  img.items = []
  img.busy = -1
  img.error = ''
  img.usedQuery = ''
  if (img.q) void searchImages(true)
}

function closeImagePicker() {
  img.open = false
  // 清空残留，下一次打开不会看到旧内容
  img.items = []
  img.q = ''
  img.usedQuery = ''
  img.error = ''
}

/** 只收起弹窗，保留候选（插入失败时还能回退展示） */
function hideImagePicker() {
  img.open = false
}

// 弹窗开着时切换到另一条标记，也要重新以新标记取图
watch(() => props.mark.id, () => {
  if (img.open) openImagePicker()
})

let searchSeq = 0

async function searchImages(smart = false) {
  const q = img.q.trim()
  if (!q) return
  // 先作废上一条在途请求，再发起新搜索
  const seq = ++searchSeq
  img.loading = true; img.error = ''; img.usedQuery = ''
  try {
    const res = await $fetch<{ candidates: ImageCandidate[]; query: string; error?: string }>('/api/images/search', {
      query: {
        q,
        count: 4,
        // 首次打开用智能改写；手动输入关键词时按字面搜索
        expand: smart ? 1 : 0,
        context: smart
          ? [props.mark.text, props.mark.context, (props.mark.detail || '').slice(0, 120)].filter(Boolean).join('；').slice(0, 200)
          : '',
      },
    })
    // 期间换了标记或重新搜索，丢弃旧结果
    if (seq !== searchSeq) return
    img.items = res.candidates || []
    if (res.query && res.query.toLowerCase() !== q.toLowerCase()) img.usedQuery = res.query
    if (!img.items.length) img.error = res.error || '没有找到合适的图片，换个关键词试试'
  } catch (e: any) {
    if (seq !== searchSeq) return
    img.error = e?.data?.message || e?.message || '搜索失败'
  } finally {
    if (seq === searchSeq) img.loading = false
  }
}

async function useImage(it: ImageCandidate, index: number) {
  if (img.busy !== -1) return
  img.busy = index
  const markId = props.mark.id
  // 点击即收起弹窗，图片在后台下载入库后插入
  hideImagePicker()
  try {
    const res = await $fetch<{ url: string }>('/api/images/import', {
      method: 'POST',
      body: { url: it.full, textId: props.textId },
    })
    if (props.mark.id !== markId) return
    insertAfterMeaning(res.url)
  } catch (e: any) {
    img.error = e?.data?.message || e?.message || '图片保存失败'
    img.open = true // 失败时才回到弹窗，候选仍在
  } finally {
    img.busy = -1
  }
}

/** 本地图片：压缩 → 上传 → 插入基本释义后 */
async function onPickFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  img.loading = true; img.error = ''
  try {
    const compressed = await compressImageFile(file)
    const form = new FormData()
    form.append('file', compressed, (compressed as File).name || 'paste.webp')
    if (props.textId) form.append('id', props.textId)
    const res = await $fetch<{ url: string }>('/api/upload/image', { method: 'POST', body: form })
    insertAfterMeaning(res.url)
    closeImagePicker()
  } catch (err: any) {
    img.error = err?.data?.message || '上传失败'
  } finally {
    img.loading = false
    input.value = ''
  }
}

/** 图片插入的锚点章节：单词放「基本释义」后，短语放「短语含义」后，句子放「含义阐述」后 */
function anchorTitles(): string[] {
  if (props.mark.type === 'phrase') return ['短语含义', '短语翻译', '基本释义']
  if (props.mark.type === 'sentence') return ['含义阐述', '句子翻译', '基本释义']
  return ['基本释义']
}

/** 把图片插到锚点章节末尾（下一个标题之前）；找不到章节则追加到文末 */
function insertAfterMeaning(url: string) {
  const imageLine = `![图片](${url})`
  const lines = (editDetail.value || '').split('\n')
  const titles = anchorTitles()
  const anchor = titles.find(t => lines.some(l => new RegExp(`^###\\s*${t}`).test(l)))

  if (anchor) {
    const start = lines.findIndex(l => new RegExp(`^###\\s*${anchor}`).test(l))
    let end = lines.length
    for (let i = start + 1; i < lines.length; i++) {
      if (/^###\s/.test(lines[i])) { end = i; break }
    }
    while (end > start + 1 && lines[end - 1].trim() === '') { lines.splice(end - 1, 1); end-- }
    lines.splice(end, 0, '', imageLine, '')
    editDetail.value = lines.join('\n')
  } else {
    editDetail.value = `${editDetail.value || ''}\n\n${imageLine}\n`
  }
  commitDetail()
}

/** 显示模式点击图片选宽度 → 改写 editDetail 里的尺寸标记并保存 */function onDetailImageResize({ src, width }: { src: string; width: string }) {
  editDetail.value = setMarkdownImageWidth(editDetail.value || props.mark.detail || '', src, width)
  commitDetail()
}
function doPronounce() { if (isPlaying.value) return; isPlaying.value = true; const w = props.mark.lemma || props.mark.text; emit('pronounce', w); playTimer = setTimeout(() => { isPlaying.value = false }, 2500) }
function handleDelete() { emit('delete') }
function close() { commitDetail(); emit('close') }
function toggleExpand() { expanded.value = !expanded.value }
function saveNote() { if (localNote.value !== props.mark.note) emit('update-note', localNote.value) }

let dragging = false; let dx = 0; let dy = 0
function startDrag(e: MouseEvent) { dragging = true; dx = e.clientX - popupX.value; dy = e.clientY - popupY.value; document.addEventListener('mousemove', onDrag); document.addEventListener('mouseup', stopDrag) }
function onDrag(e: MouseEvent) { if (!dragging) return; popupX.value = Math.max(0, Math.min(e.clientX - dx, window.innerWidth - 100)); popupY.value = Math.max(0, Math.min(e.clientY - dy, window.innerHeight - 60)) }

/** 触屏拖动：按住头部即可在屏幕内自由移动弹窗 */
function startDragTouch(e: TouchEvent) {
  const t = e.touches[0]; if (!t) return
  dragging = true
  dx = t.clientX - popupX.value; dy = t.clientY - popupY.value
  const move = (ev: TouchEvent) => {
    if (!dragging) return
    const tt = ev.touches[0]; if (!tt) return
    ev.preventDefault() // 拖动头部时不滚动页面
    popupX.value = Math.max(0, Math.min(tt.clientX - dx, window.innerWidth - 80))
    popupY.value = Math.max(0, Math.min(tt.clientY - dy, window.innerHeight - 60))
  }
  const up = () => {
    dragging = false
    document.removeEventListener('touchmove', move)
    document.removeEventListener('touchend', up)
    document.removeEventListener('touchcancel', up)
  }
  document.addEventListener('touchmove', move, { passive: false })
  document.addEventListener('touchend', up)
  document.addEventListener('touchcancel', up)
}
function stopDrag() { dragging = false; document.removeEventListener('mousemove', onDrag); document.removeEventListener('mouseup', stopDrag) }
let resizing = false; let rx = 0; let ry = 0
function startResize(e: MouseEvent) { e.stopPropagation(); resizing = true; rx = e.clientX; ry = e.clientY; document.addEventListener('mousemove', onResize); document.addEventListener('mouseup', stopResize) }
function onResize(e: MouseEvent) { if (!resizing) return; popupW.value = Math.max(300, popupW.value + e.clientX - rx); popupH.value = Math.max(250, popupH.value + e.clientY - ry); rx = e.clientX; ry = e.clientY }
function stopResize() { resizing = false; document.removeEventListener('mousemove', onResize); document.removeEventListener('mouseup', stopResize) }
onUnmounted(() => { stopDrag(); stopResize(); if (playTimer) clearTimeout(playTimer) })
const popupStyle = computed(() => ({ left: `${popupX.value}px`, top: `${popupY.value}px`, width: `${popupW.value}px`, height: expanded.value ? `${popupH.value}px` : 'auto' }))
</script>

<style scoped>
.mark-popup { position: fixed; z-index: 3000; background: #ffffff; border-radius: 14px; box-shadow: 0 16px 48px rgba(0,0,0,0.22); overflow: hidden; display: flex; flex-direction: column; }
.mp-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; color: #ffffff; cursor: grab; flex-shrink: 0; }
.mp-header:active { cursor: grabbing; }
.mp-type { font-size: 12px; font-weight: 600; letter-spacing: 0.04em; }
.mp-header-actions { display: flex; gap: 2px; }
.mp-btn-icon { width: 26px; height: 26px; border: none; border-radius: 6px; background: rgba(255,255,255,0.2); color: #ffffff; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.mp-btn-icon:hover { background: rgba(255,255,255,0.35); }
.mp-delete:hover { background: rgba(239,68,68,0.5) !important; }
.mp-close-btn:hover { background: rgba(239,68,68,0.5) !important; }
.mp-expand-btn { font-size: 0; }
.mp-chevron { transition: transform 0.2s ease; }
.mp-chevron.open { transform: rotate(180deg); }
.mp-body { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.mp-loading { display: flex; align-items: center; gap: 8px; color: #64748b; font-size: 13px; }

/* 编辑/显示 切换 + AI 生成 */
.mp-tabs { display: flex; align-items: center; gap: 2px; border-bottom: 0.5px solid rgba(0,0,0,0.08); padding-bottom: 8px; }
.mp-tab { padding: 4px 12px; font-size: 11.5px; font-weight: 500; color: #8a8880; background: transparent; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.12s; }
.mp-tab.active { color: #3d3591; border-bottom-color: #3d3591; }
.mp-auto-toggle { margin-left: auto; display: flex; align-items: center; padding: 2px; border-radius: 6px; background: #f1f5f9; }
.mp-auto-toggle button { padding: 2px 7px; border: none; border-radius: 4px; background: transparent; color: #94a3b8; font-size: 10.5px; font-family: 'DM Sans', sans-serif; cursor: pointer; transition: all 0.12s; }
.mp-auto-toggle button.active { background: #fff; color: #3d3591; box-shadow: 0 1px 2px rgba(15,23,42,0.08); }
.mp-ai-btn { margin-left: 6px; width: 25px; height: 25px; display: flex; align-items: center; justify-content: center; padding: 0; color: #3d3591; background: rgba(61,53,145,0.08); border: 1px solid transparent; border-radius: 50%; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: color 0.15s, background 0.15s, transform 0.15s; flex-shrink: 0; }
.mp-ai-btn:hover:not(:disabled) { background: #3d3591; color: #fff; transform: translateY(-1px); box-shadow: 0 3px 8px rgba(61,53,145,0.22); }
.mp-ai-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.mp-word-row { display: flex; align-items: center; gap: 8px; border-left: 3px solid; padding-left: 10px; }
.mp-word-text { font-size: 1.15em; font-weight: 600; color: #1e293b; }
.mp-phonetic { font-family: 'Georgia', serif; font-size: 0.95em; color: #6366f1; }
.mp-word-text .mp-lemma { font-size: inherit; color: #8b5cf6; font-weight: 400; }
.mp-play-btn { display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 1.5px solid #6366f1; border-radius: 50%; background: transparent; color: #6366f1; cursor: pointer; transition: all 0.15s; flex-shrink: 0; }
.mp-play-btn:hover { background: #eef2ff; }
.mp-play-btn.playing { background: #eef2ff; border-color: #818cf8; }
.playing-bars { display: flex; align-items: flex-end; gap: 2px; height: 11px; }
.playing-bars span { width: 2px; background: #6366f1; border-radius: 1px; animation: barAnim 0.7s infinite ease-in-out alternate; }
.playing-bars span:nth-child(1) { height: 6px; animation-delay: 0s; }
.playing-bars span:nth-child(2) { height: 11px; animation-delay: 0.12s; }
.playing-bars span:nth-child(3) { height: 8px; animation-delay: 0.24s; }
@keyframes barAnim { from { transform: scaleY(0.4); opacity: 0.4; } to { transform: scaleY(1); opacity: 1; } }

/* 编辑区 */
.mp-edit-area { flex: 1; display: flex; }
.mp-edit-input { flex: 1; width: 100%; min-height: 140px; padding: 10px 12px; border: 0.5px solid rgba(0,0,0,0.12); border-radius: 8px; font-family: 'DM Mono', 'SF Mono', monospace; font-size: 12px; line-height: 1.7; color: #334155; resize: vertical; outline: none; background: #f8f7f4; }
.mp-edit-input:focus { border-color: #3d3591; box-shadow: 0 0 0 2px rgba(61,53,145,0.08); background: #fff; }

.mp-detail { font-size: 0.88em; }
/* 标记解释：标题不放大，保持与流式输出一致的文字大小 */
.mp-detail :deep(h1),
.mp-detail :deep(h2),
.mp-detail :deep(h3),
.mp-detail :deep(h4),
.mp-detail :deep(h5),
.mp-detail :deep(h6) {
  font-size: 1em !important;
  border-bottom: none !important;
  margin: 0.5em 0 0.3em;
}
.tc-typing { display: inline; color: #6366f1; animation: blink 0.8s infinite; }
@keyframes blink { 0%,50%{opacity:1} 51%,100%{opacity:0} }
.mp-note { border-top: 1px solid #f1f5f9; padding-top: 8px; }
.mp-note-input { width: 100%; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 8px; font-family: inherit; font-size: 12px; resize: vertical; outline: none; background: #fafbfc; }
.mp-note-input:focus { border-color: #6366f1; background: #ffffff; }
.mp-resize-handle { position: absolute; bottom: 0; right: 0; width: 16px; height: 16px; cursor: nwse-resize; }
.mp-resize-handle::after { content: ''; position: absolute; bottom: 4px; right: 4px; width: 8px; height: 8px; border-right: 2px solid #cbd5e1; border-bottom: 2px solid #cbd5e1; }
.spinner-sm { width: 14px; height: 14px; border: 2px solid #e2e8f0; border-top-color: #6366f1; border-radius: 50%; animation: spin 0.6s linear infinite; }
.spinner-xs { animation: spin 0.6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* 自动配图 */
.mp-img-btn {
  margin-left: 2px; padding: 4px 10px; font-size: 11.5px; font-weight: 500;
  color: #8a8880; background: transparent; border: none; border-bottom: 2px solid transparent;
  cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.12s;
}
.mp-img-btn:hover { color: #3d3591; }
.mp-img-btn.active { color: #3d3591; border-bottom-color: #3d3591; }
.mp-img-panel { border: 0.5px solid rgba(0,0,0,0.1); border-radius: 10px; padding: 10px; background: #faf9f6; }
.mp-img-search { display: flex; gap: 6px; }
.mp-img-input {
  flex: 1; min-width: 0; padding: 6px 9px; font-size: 12px; font-family: 'DM Sans', sans-serif;
  border: 0.5px solid rgba(0,0,0,0.14); border-radius: 7px; background: #fff; outline: none; color: #334155;
}
.mp-img-input:focus { border-color: #3d3591; }
.mp-img-go {
  flex-shrink: 0; padding: 0 12px; font-size: 12px; font-family: 'DM Sans', sans-serif;
  color: #fff; background: #3d3591; border: none; border-radius: 7px; cursor: pointer;
}
.mp-img-go:disabled { opacity: 0.55; cursor: default; }
.mp-img-error { margin: 6px 0 0; font-size: 11.5px; color: #b45309; line-height: 1.5; }
.mp-img-expand {
  display: flex; align-items: center; gap: 5px; margin-top: 7px;
  font-size: 11px; color: #8a8880; cursor: pointer; user-select: none;
}
.mp-img-expand input { width: 12px; height: 12px; accent-color: #3d3591; cursor: pointer; }
.mp-img-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 10px; }
.mp-img-cell {
  position: relative; padding: 0; border: 0.5px solid rgba(0,0,0,0.1); border-radius: 6px;
  overflow: hidden; background: #fff; cursor: pointer; aspect-ratio: 4 / 3;
}
.mp-img-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mp-img-cell:hover { border-color: #3d3591; }
.mp-img-busy {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.82); font-size: 11px; color: #3d3591;
}
.mp-img-hint { margin: 8px 0 0; font-size: 11px; color: #8a8880; line-height: 1.5; }

/* 配图选择弹窗 */
.mp-picker-overlay {
  position: fixed; inset: 0; z-index: 3500; background: rgba(0,0,0,0.35);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.mp-picker {
  width: 100%; max-width: 380px; max-height: 80vh; overflow: hidden;
  background: #fff; border-radius: 14px; padding: 0;
  display: flex; flex-direction: column;
}
.mp-picker-head {
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0; padding: 9px 14px; background: #faf9f6;
  border-bottom: 0.5px solid rgba(0,0,0,0.08);
}
.mp-picker-title { font-size: 12px; font-weight: 500; color: #6b6963; font-family: 'DM Sans', sans-serif; letter-spacing: .03em; }
.mp-picker-body { padding: 12px 14px 14px; overflow-y: auto; }
.mp-picker-close {
  flex-shrink: 0; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  border: none; background: none; font-size: 18px;
  line-height: 1; color: #b4b2a9; cursor: pointer; padding: 0;
}
.mp-picker-close:hover { color: #5f5e5a; }
.mp-picker-search { display: flex; align-items: center; gap: 6px; }
.mp-picker-actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.mp-picker-upload {
  padding: 5px 11px; border: 0.5px solid rgba(0,0,0,0.12); border-radius: 6px;
  background: #fff; font-size: 11px; color: #5f5e5a; cursor: pointer; font-family: 'DM Sans', sans-serif;
}
.mp-picker-upload:hover { border-color: rgba(61,53,145,0.35); color: #3d3591; }
.mp-picker-tip { font-size: 11px; color: #a09e97; }
.mp-img-trigger { margin-left: 6px; }

/* 手机端：限制高度、内容可滚动；位置与宽度由 JS 设定，可拖动、不全宽 */
@media (max-width: 767px) and (pointer: coarse) {
  .mark-popup { max-height: 72vh; font-size: 13px; }
  /* 内容区可滚动：超出部分滑动查看 */
  .mark-popup > * { flex-shrink: 0; }
  .mark-popup > .mp-detail,
  .mark-popup > .mp-edit-area {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  .mark-popup > .mp-detail { padding-right: 2px; line-height: 1.55; }
  .mark-popup > .mp-note textarea { min-height: unset; height: 52px; }
  .mp-header { touch-action: none; }
  .mp-resize-handle { display: none !important; }
}
</style>
