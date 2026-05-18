<template>
  <div
    class="library-layout"
    @dragover.prevent="dragOver = true"
    @dragleave.prevent="dragOver = false"
    @drop.prevent="handleGlobalDrop"
  >
    <!-- 全局拖拽提示 -->
    <Transition name="drag-fade">
      <div v-if="dragOver" class="drag-overlay">
        <div class="drag-hint">
          <div class="drag-hint-ring">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <p>释放以上传文件</p>
        </div>
      </div>
    </Transition>

    <!-- 左侧文件夹 -->
    <aside class="lib-sidebar">
      <FolderSidebar
        ref="sidebarRef"
        :folders="folders"
        :active-folder="activeFolder"
        :counts="folderCounts"
        @select="activeFolder = $event"
        @create="handleCreateFolder"
        @drop-on-folder="handleDropOnFolder"
        @delete-folder="handleDeleteFolder"
        @add-sub="(pid: string) => sidebarRef?.startSubCreate(pid)"
      />
    </aside>

    <!-- 右侧内容区 -->
    <main class="lib-main">
      <header class="lib-toolbar">
        <div class="lib-toolbar-row">
          <div class="lib-toolbar-left">
            <h1 class="lib-title">{{ activeFolderName }}</h1>
            <span v-if="filteredBooks.length" class="lib-count">{{ filteredBooks.length }} 本</span>
            <div class="lib-filter-bar">
              <button
                v-for="f in filterOptions"
                :key="f.key"
                class="lib-filter-chip"
                :class="{ active: sourceFilter === f.key }"
                @click="sourceFilter = f.key"
              >{{ f.label }}</button>
            </div>
          </div>
          <div class="lib-actions">
            <button class="lib-action-btn" @click="showVideoImport = true" title="导入视频">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
              <span>导入视频</span>
            </button>
            <button class="lib-action-btn" @click="showUpload = true" title="上传文件">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-1.5-.5"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span>上传文件</span>
            </button>
            <button class="lib-action-btn" @click="showUrl = true" title="提取网页">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              <span>网址</span>
            </button>
            <button class="lib-action-btn accent" @click="navigateTo('/reviews')" title="复习本">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              <span>复习本</span>
            </button>
          </div>
        </div>
      </header>

      <!-- 书本网格 -->
      <div v-if="filteredBooks.length > 0" class="lib-grid">
        <BookCard
          v-for="(book, i) in filteredBooks"
          :key="book.id"
          :id="book.id"
          :title="book.title"
          :length="book.length"
          :source="book.source"
          :read-count="book.readCount"
          :mark-count="book.markCount"
          :duration="book.duration"
          :thumbnail="(book as any).thumbnail"
          :completed-at="(book as any).completedAt"
          :draggable="true"
          :style="{ '--enter-delay': Math.min(i * 0.03, 0.6) + 's' }"
          @dragstart="handleBookDragStart($event, book.id)"
          @open="openBook"
          @menu="openContextMenu($event, book)"
          @contextmenu.prevent
        />
      </div>

      <!-- 空态 -->
      <div v-else class="lib-empty">
        <div class="lib-empty-illustration">
          <div class="empty-shelf">
            <span class="empty-book" v-for="i in 3" :key="i" :style="{ '--i': i }"></span>
          </div>
        </div>
        <p class="lib-empty-title">{{ sourceFilter === 'video' ? '还没有视频' : '书架是空的' }}</p>
        <p class="lib-empty-hint">{{ sourceFilter === 'video' ? '点击「导入视频」添加 YouTube 或本地视频' : '拖拽 PDF / Markdown / TXT 文件到此处，或点击上方按钮' }}</p>
      </div>

      <!-- 视频导入弹窗 -->
      <VideoImportModal
        v-if="showVideoImport"
        @imported="handleVideoImported"
        @close="showVideoImport = false"
      />
    </main>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <Transition name="ctx-enter">
        <div
          v-if="contextMenu.show"
          class="context-menu-backdrop"
          @click="contextMenu.show = false"
        >
          <div
            class="context-menu"
            :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
            @click.stop
          >
            <button @click="renameBook">重命名</button>
            <button @click="toggleComplete">{{ contextMenu.completedAt ? '取消完成' : '标记完成' }}</button>
            <hr class="ctx-divider" />
            <button class="ctx-danger" @click="deleteBook">删除</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 网址输入弹窗 -->
    <Transition name="modal-fade">
      <div v-if="showUrl" class="modal-overlay" @click.self="showUrl = false">
        <div class="modal-card">
          <div class="modal-header">
            <h3 class="modal-title">提取网页文章</h3>
            <button class="modal-close" @click="showUrl = false">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="modal-body">
            <input
              v-model="urlInput"
              class="modal-input"
              placeholder="粘贴文章链接 https://..."
              @keydown.enter="fetchUrl"
              autofocus
            />
            <div v-if="urlLoading" class="modal-loading">
              <div class="spinner"></div>
              <p>正在提取文章内容…</p>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-ghost" @click="showUrl = false">取消</button>
            <button class="btn-primary" :disabled="!urlInput.trim() || urlLoading" @click="fetchUrl">提取</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 上传弹窗 -->
    <Transition name="modal-fade">
      <div v-if="showUpload || showPaste" class="modal-overlay" @click.self="closeModal">
        <div class="modal-card" style="max-width: 520px">
          <div class="modal-header">
            <h3 class="modal-title">{{ showUpload ? '上传文件' : '粘贴文本' }}</h3>
            <button class="modal-close" @click="closeModal">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="modal-body">
            <TextUploader
              :raw-text="''"
              :is-processing="uploading"
              @submit-text="handleModalText"
              @analyze="() => {}"
              @clear="closeModal"
            />
          </div>
        </div>
      </div>
    </Transition>

    <!-- 重命名弹窗 -->
    <Transition name="modal-fade">
      <div v-if="showRename" class="modal-overlay" @click.self="showRename = false">
        <div class="modal-card" style="max-width: 400px">
          <div class="modal-header">
            <h3 class="modal-title">重命名</h3>
            <button class="modal-close" @click="showRename = false">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="modal-body">
            <input
              v-model="renameText"
              class="modal-input"
              placeholder="输入新标题"
              @keydown.enter="doRename"
              autofocus
            />
          </div>
          <div class="modal-footer">
            <button class="btn-ghost" @click="showRename = false">取消</button>
            <button class="btn-primary" @click="doRename" :disabled="!renameText.trim()">确认</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
useHead({ title: 'AI 阅读分析 - 书架' })

interface Folder { id: string; name: string }
interface BookItem { id: string; title: string; source: string; length: number; duration?: number; completedAt?: string }

const videoSources = ['youtube', 'bilibili', 'video_file', 'audio_file']

const activeFolder = ref('default')

const filterOptions = [
  { key: 'all', label: '全部' },
  { key: 'text', label: '文本' },
  { key: 'video', label: '视频' },
]

// SSR 预取
const { data: folders, refresh: refreshFolders } = await useAsyncData('folders', () =>
  $fetch<Folder[]>('/api/folder/list'), { default: () => [] as Folder[] }
)

const { data: books, refresh: refreshBooks } = await useAsyncData(
  'books',
  () => $fetch<BookItem[]>(`/api/text/list?folder=${activeFolder.value}`),
  { watch: [activeFolder], default: () => [] as BookItem[] }
)

const folderCounts = ref<Record<string, number>>({})
const showUpload = ref(false)
const showPaste = ref(false)
const showUrl = ref(false)
const showVideoImport = ref(false)
const sidebarRef = ref<any>(null)
const urlInput = ref('')
const urlLoading = ref(false)
const uploading = ref(false)
const dragOver = ref(false)

const sourceFilter = ref<string>('all')

const filteredBooks = computed(() => {
  if (sourceFilter.value === 'video') return books.value.filter(b => videoSources.includes(b.source))
  if (sourceFilter.value === 'text') return books.value.filter(b => !videoSources.includes(b.source) && b.source !== '')
  return books.value
})

const contextMenu = reactive({ show: false, x: 0, y: 0, bookId: '', completedAt: '' })
const showRename = ref(false)
const renameText = ref('')
const renameBookId = ref('')

const activeFolderName = computed(() => folders.value.find((f) => f.id === activeFolder.value)?.name || '默认文件夹')

async function loadFolders() {
  try { await refreshFolders() } catch {}
}

async function loadBooks() {
  try { await refreshBooks() } catch {}
  counts()
}

function handleVideoImported(result: { id: string; title: string }) {
  showVideoImport.value = false
  loadBooks()
  if (result.id) navigateTo(`/watch/${result.id}`)
}

async function counts() {
  const m: Record<string, number> = {}
  for (const f of folders.value) {
    try { m[f.id] = (await $fetch<BookItem[]>(`/api/text/list?folder=${f.id}`)).length } catch { m[f.id] = 0 }
  }
  folderCounts.value = m
}

async function handleCreateFolder(name: string, parent?: string) {
  try { await $fetch('/api/folder/create', { method: 'POST', body: { name, parent: parent || '' } }); await loadFolders() } catch (e: any) {}
}

async function handleDeleteFolder(id: string) {
  try { await $fetch('/api/folder/delete', { method: 'POST', body: { id } }); await loadFolders() } catch (e: any) { alert(e?.message || '删除失败') }
}

async function handleDropOnFolder(folderId: string) {
  if (!dragBookId || folderId === activeFolder.value) return
  try {
    await $fetch('/api/text/move', { method: 'POST', body: { id: dragBookId, folder: folderId } })
    await loadBooks()
  } catch (e: any) {}
}

function openBook(id: string) {
  const book = books.value.find(b => b.id === id)
  if (book && videoSources.includes(book.source)) {
    navigateTo(`/watch/${id}`)
  } else {
    navigateTo(`/read/${id}`)
  }
}

async function handleGlobalDrop(e: DragEvent) {
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  await processDroppedFile(file)
}

async function processDroppedFile(file: File) {
  uploading.value = true
  try {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext === 'pdf') {
      const fd = new FormData(); fd.append('file', file)
      const result = await $fetch<{ text: string; filePath: string }>('/api/parse-pdf', { method: 'POST', body: fd })
      if (result?.text) {
        await $fetch('/api/text/save', { method: 'POST', body: { text: result.text, source: file.name, folder: activeFolder.value, filePath: result.filePath } })
        await loadBooks()
      }
    } else if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
      const text = await file.text()
      if (text.trim()) {
        await $fetch('/api/text/save', { method: 'POST', body: { text, source: file.name, folder: activeFolder.value } })
        await loadBooks()
      }
    }
  } catch (e: any) { alert('上传失败: ' + (e?.message || '')) }
  finally { uploading.value = false }
}

let dragBookId = ''
function handleBookDragStart(e: DragEvent, id: string) {
  dragBookId = id
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) }
}

function openContextMenu(e: MouseEvent, book: BookItem) {
  contextMenu.show = true
  contextMenu.x = Math.min(e.clientX, window.innerWidth - 180)
  contextMenu.y = Math.min(e.clientY, window.innerHeight - 160)
  contextMenu.bookId = book.id
  contextMenu.completedAt = book.completedAt || ''
}

async function renameBook() {
  renameBookId.value = contextMenu.bookId; renameText.value = ''; showRename.value = true; contextMenu.show = false
}

async function doRename() {
  if (!renameText.value.trim()) return
  try {
    await $fetch('/api/text/rename', { method: 'POST', body: { id: renameBookId.value, title: renameText.value.trim() } })
    showRename.value = false; await loadBooks()
  } catch (e: any) {}
}

async function deleteBook() {
  if (!confirm('确定删除这本书？所有标记和笔记将一并删除。')) return
  try {
    await $fetch('/api/text/delete', { method: 'POST', body: { id: contextMenu.bookId } })
    contextMenu.show = false; await loadBooks()
  } catch (e: any) {}
}

async function toggleComplete() {
  try {
    if (contextMenu.completedAt) {
      await $fetch('/api/text/uncomplete', { method: 'POST', body: { id: contextMenu.bookId } })
    } else {
      await $fetch('/api/text/complete', { method: 'POST', body: { id: contextMenu.bookId } })
    }
    contextMenu.show = false
    await loadBooks()
  } catch (e: any) {}
}

async function handleModalText(text: string, filePath?: string) {
  uploading.value = true
  try {
    const result = await $fetch<{ id: string }>('/api/text/save', {
      method: 'POST',
      body: { text, source: showPaste.value ? 'paste' : 'upload', folder: activeFolder.value, filePath },
    })
    closeModal(); await loadBooks()
    if (result.id) navigateTo(`/read/${result.id}`)
  } catch (e: any) { alert('保存失败: ' + (e?.message || '')) }
  finally { uploading.value = false }
}

function closeModal() { showUpload.value = false; showPaste.value = false }

async function fetchUrl() {
  const u = urlInput.value.trim(); if (!u || urlLoading.value) return
  urlLoading.value = true
  try {
    const result = await $fetch<{ id: string }>('/api/fetch-url', { method: 'POST', body: { url: u } })
    showUrl.value = false; urlInput.value = ''
    if (result.id) { await loadBooks(); navigateTo(`/read/${result.id}`) }
  } catch (e: any) { alert('提取失败: ' + (e?.message || '请检查网址或稍后重试')) }
  finally { urlLoading.value = false }
}

onMounted(() => { counts() })
</script>

<style scoped>
/* ── Layout ── */
.library-layout {
  display: flex;
  height: 100vh;
  width: 100vw;
  background: #f7f6f3;
  overflow: hidden;
}

.lib-sidebar {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid rgba(0, 0, 0, 0.05);
  background: #f0efe9;
}

.lib-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Toolbar ── */
.lib-toolbar {
  flex-shrink: 0;
  padding: 28px 40px 0;
}

.lib-toolbar-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.lib-toolbar-left {
  display: flex;
  align-items: baseline;
  gap: 14px;
  flex-wrap: wrap;
}

.lib-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.lib-title {
  font-family: 'Lora', Georgia, serif;
  font-size: 1.35em;
  font-weight: 500;
  color: #1a1a18;
  letter-spacing: -0.01em;
  margin: 0;
}

.lib-count {
  font-size: 13px;
  color: #a09e97;
  font-weight: 400;
  font-family: 'DM Sans', sans-serif;
}

.lib-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 14px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  background: #ffffff;
  color: #6b6963;
  font-size: 13px;
  font-weight: 450;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
  white-space: nowrap;
}
.lib-action-btn:hover {
  color: #1a1a18;
  border-color: rgba(0, 0, 0, 0.14);
  background: #fafaf8;
}
.lib-action-btn.accent {
  color: #3d3591;
  border-color: rgba(61, 53, 145, 0.15);
  background: #f9f7ff;
}
.lib-action-btn.accent:hover {
  background: #3d3591;
  color: #ffffff;
  border-color: #3d3591;
}

/* ── Filter Chips (inline next to title) ── */
.lib-filter-bar {
  display: flex;
  gap: 4px;
}

.lib-filter-chip {
  padding: 4px 12px;
  border-radius: 8px;
  border: none;
  background: rgba(0, 0, 0, 0.03);
  font-size: 12.5px;
  font-weight: 450;
  color: #8a877c;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
}
.lib-filter-chip:hover {
  color: #4a4640;
  background: rgba(0, 0, 0, 0.06);
}
.lib-filter-chip.active {
  background: #ffffff;
  color: #3d3591;
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}

/* ── Grid ── */
.lib-grid {
  flex: 1;
  overflow-y: auto;
  padding: 28px 40px 40px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 18px;
  align-content: start;
}
.lib-grid > * {
  animation: cardRise 0.5s ease-out both;
  animation-delay: var(--enter-delay, 0s);
}
@keyframes cardRise {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ── Empty State ── */
.lib-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 24px;
  text-align: center;
}
.lib-empty-illustration {
  margin-bottom: 24px;
}
.empty-shelf {
  display: flex;
  gap: 10px;
}
.empty-book {
  width: 36px;
  height: 56px;
  border-radius: 4px;
  background: #e8e6df;
  opacity: calc(0.5 - var(--i) * 0.12);
  transform: rotate(calc((var(--i) - 2) * 3deg));
}

.lib-empty-title {
  font-family: 'Lora', Georgia, serif;
  font-size: 1.1em;
  color: #a09e97;
  margin: 0 0 6px;
}
.lib-empty-hint {
  font-size: 13px;
  color: #c4c1ba;
  margin: 0;
  max-width: 360px;
  line-height: 1.6;
}

/* ── Drag Overlay ── */
.drag-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(247, 246, 243, 0.75);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.drag-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  color: #3d3591;
}
.drag-hint-ring {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: 2px dashed rgba(61, 53, 145, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: pulseRing 2s infinite;
}
@keyframes pulseRing {
  0%, 100% { border-color: rgba(61, 53, 145, 0.25); }
  50% { border-color: rgba(61, 53, 145, 0.5); }
}
.drag-hint p {
  font-size: 14px;
  font-weight: 450;
  color: #6b6963;
}
.drag-fade-enter-active { transition: opacity 0.2s; }
.drag-fade-leave-active { transition: opacity 0.15s; }
.drag-fade-enter-from,
.drag-fade-leave-to { opacity: 0; }

/* ── Context Menu ── */
.context-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
}
.context-menu {
  position: fixed;
  z-index: 201;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.1);
  padding: 6px;
  min-width: 150px;
}
.context-menu button {
  display: block;
  width: 100%;
  padding: 9px 14px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-size: 13px;
  color: #4a4640;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: background 0.12s;
}
.context-menu button:hover {
  background: rgba(0, 0, 0, 0.04);
}
.context-menu .ctx-danger {
  color: #b84b2e;
}
.context-menu .ctx-danger:hover {
  background: #fef2f2;
}
.ctx-divider {
  border: none;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  margin: 4px 8px;
}
.ctx-enter-enter-active { transition: opacity 0.12s; }
.ctx-enter-leave-active { transition: opacity 0.1s; }
.ctx-enter-enter-from,
.ctx-enter-leave-to { opacity: 0; }

/* ── Modals ── */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(45, 42, 38, 0.3);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal-card {
  background: #ffffff;
  border-radius: 16px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.12);
  width: 90vw;
  max-width: 460px;
  overflow: hidden;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px 0;
}
.modal-title {
  font-family: 'Lora', Georgia, serif;
  font-size: 1.1em;
  font-weight: 500;
  color: #1a1a18;
  margin: 0;
}
.modal-close {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #a09e97;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.modal-close:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #4a4640;
}
.modal-body {
  padding: 18px 22px;
}
.modal-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  font-size: 14px;
  color: #1a1a18;
  background: #fafaf8;
  outline: none;
  font-family: inherit;
  transition: border-color 0.2s;
}
.modal-input:focus {
  border-color: #3d3591;
  background: #ffffff;
}
.modal-loading {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0 4px;
  color: #a09e97;
  font-size: 13px;
}
.spinner {
  width: 16px; height: 16px;
  border: 2px solid #e8e6df;
  border-top-color: #3d3591;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 0 22px 18px;
}

.btn-ghost {
  padding: 8px 18px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #8a877c;
  font-size: 13px;
  font-weight: 450;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}
.btn-ghost:hover { background: rgba(0, 0, 0, 0.04); color: #4a4640; }

.btn-primary {
  padding: 8px 22px;
  border: none;
  border-radius: 10px;
  background: #3d3591;
  color: #ffffff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}
.btn-primary:hover { background: #2f2875; }
.btn-primary:disabled { opacity: 0.4; cursor: default; }

.modal-fade-enter-active { transition: opacity 0.2s; }
.modal-fade-leave-active { transition: opacity 0.15s; }
.modal-fade-enter-from,
.modal-fade-leave-to { opacity: 0; }
</style>
