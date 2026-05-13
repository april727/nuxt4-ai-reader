<template>
  <div
    class="library-layout"
    @dragover.prevent="dragOver = true"
    @dragleave.prevent="dragOver = false"
    @drop.prevent="handleGlobalDrop"
  >
    <!-- 全局拖拽提示 -->
    <div v-if="dragOver" class="drag-overlay">
      <div class="drag-hint">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <line x1="9" y1="15" x2="12" y2="12"/>
          <line x1="15" y1="15" x2="12" y2="12"/>
        </svg>
        <p>释放文件以上传</p>
      </div>
    </div>

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
      <div class="lib-toolbar">
        <h1 class="lib-title">{{ activeFolderName }}</h1>
        <div class="lib-actions">
          <button class="lib-btn" @click="navigateTo('/reviews')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            复习本
          </button>
          <button class="lib-btn" @click="showUpload = true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            上传文件
          </button>
          <button class="lib-btn primary" @click="showPaste = true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            粘贴文本
          </button>
          <button class="lib-btn" @click="showUrl = true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            网址
          </button>
          <button class="lib-btn" @click="showSearch = !showSearch" title="搜索">🔍</button>
          <button class="theme-toggle" @click="theme.toggle()" :title="theme.dark.value ? '浅色' : '深色'">
            {{ theme.dark.value ? '☀' : '🌙' }}
          </button>
        </div>
        <div v-if="showSearch" class="lib-search-bar">
          <input v-model="searchQ" class="chat-input-field" placeholder="搜索全部文本..." @keydown.enter="doSearch" />
          <div v-if="searchResults.length" class="search-results">
            <div v-for="r in searchResults" :key="r.id" class="search-item" @click="navigateTo(`/read/${r.id}`)">
              <span class="search-title">{{ r.title }}</span>
              <span class="search-context" v-html="highlightMatch(r.context, searchQ)"></span>
            </div>
          </div>
        </div>
      </div>

      <!-- 书本网格（支持拖入文件夹） -->
      <div v-if="books.length > 0" class="lib-grid">
        <BookCard
          v-for="book in books"
          :key="book.id"
          :id="book.id"
          :title="book.title"
          :length="book.length"
          :source="book.source"
          :read-count="book.readCount"
          :mark-count="book.markCount"
          draggable="true"
          @dragstart="handleBookDragStart($event, book.id)"
          @open="openBook"
          @contextmenu.prevent="openContextMenu($event, book)"
        />
      </div>

      <div v-else class="lib-empty">
        <div class="lib-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
        </div>
        <p>拖拽文件到此处，或点击上方按钮</p>
        <p class="lib-empty-hint">支持 PDF、Markdown、TXT</p>
      </div>
    </main>

    <!-- 右键菜单 -->
    <div
      v-if="contextMenu.show"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @click.self="contextMenu.show = false"
    >
      <button @click="renameBook">重命名</button>
      <button @click="deleteBook">删除</button>
      <button class="danger" @click="contextMenu.show = false">取消</button>
    </div>

    <!-- 上传/粘贴弹窗 -->
    <!-- 网址输入弹窗 -->
    <div v-if="showUrl" class="modal-overlay" @click.self="showUrl = false">
      <div class="modal-content" style="max-width:440px">
        <div class="modal-header"><span>提取网页文章</span><button class="modal-close" @click="showUrl = false">&times;</button></div>
        <input v-model="urlInput" class="rename-input" placeholder="https://..." @keydown.enter="fetchUrl" />
        <div v-if="urlLoading" class="processing"><div class="spinner"></div><p>正在提取...</p></div>
        <div class="paste-actions"><button class="btn-ghost" @click="showUrl = false">取消</button><button class="btn-primary" :disabled="!urlInput.trim() || urlLoading" @click="fetchUrl">提取</button></div>
      </div>
    </div>

    <div v-if="showUpload || showPaste" class="modal-overlay" @click.self="closeModal">
      <div class="modal-content">
        <div class="modal-header">
          <span>{{ showUpload ? '上传文件' : '粘贴文本' }}</span>
          <button class="modal-close" @click="closeModal">&times;</button>
        </div>
        <TextUploader
          :raw-text="''"
          :is-processing="uploading"
          @submit-text="handleModalText"
          @analyze="() => {}"
          @clear="closeModal"
        />
      </div>
    </div>

    <!-- 重命名弹窗 -->
    <div v-if="showRename" class="modal-overlay" @click.self="showRename = false">
      <div class="modal-content" style="max-width: 400px">
        <div class="modal-header"><span>重命名</span><button class="modal-close" @click="showRename = false">&times;</button></div>
        <input v-model="renameText" class="rename-input" @keydown.enter="doRename" placeholder="输入新标题" />
        <div class="paste-actions"><button class="btn-ghost" @click="showRename = false">取消</button><button class="btn-primary" @click="doRename">确认</button></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTheme } from '~/composables/useTheme'
useHead({ title: 'AI 阅读分析 - 书架' })
const theme = useTheme()

interface Folder { id: string; name: string }
interface BookItem { id: string; title: string; source: string; length: number }

const folders = ref<Folder[]>([])
const activeFolder = ref('default')
const books = ref<BookItem[]>([])
const folderCounts = ref<Record<string, number>>({})
const showUpload = ref(false)
const showPaste = ref(false)
const showUrl = ref(false)
const sidebarRef = ref<any>(null)
const showSearch = ref(false); const searchQ = ref(''); const searchResults = ref<any[]>([])
async function doSearch() {
  if (!searchQ.value.trim()) { searchResults.value = []; return }
  try { searchResults.value = await $fetch(`/api/text/search?q=${encodeURIComponent(searchQ.value)}`) } catch { searchResults.value = [] }
}
function highlightMatch(t: string, q: string) {
  if (!t || !q) return t
  return t.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark class="search-hl">$1</mark>')
}
const urlInput = ref('')
const urlLoading = ref(false)
const uploading = ref(false)
const dragOver = ref(false)

// 右键菜单
const contextMenu = reactive({ show: false, x: 0, y: 0, bookId: '' })
const showRename = ref(false)
const renameText = ref('')
const renameBookId = ref('')

const activeFolderName = computed(() => folders.value.find((f) => f.id === activeFolder.value)?.name || '默认文件夹')

async function loadFolders() {
  try { folders.value = await $fetch<Folder[]>('/api/folder/list') } catch {}
}

async function loadBooks() {
  try {
    const data = await $fetch<BookItem[]>(`/api/text/list?folder=${activeFolder.value}`)
    books.value = data
    counts()
  } catch { books.value = [] }
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

function openBook(id: string) { navigateTo(`/read/${id}`) }

// 全局拖拽上传
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

// 书本拖拽移到文件夹
let dragBookId = ''
function handleBookDragStart(e: DragEvent, id: string) {
  dragBookId = id
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) }
}

// FolderSidebar 需要接收 drop 事件。在 FolderSidebar 组件中添加 @drop 支持
// 这里简化：双击书本时移动

// 右键菜单
function openContextMenu(e: MouseEvent, book: BookItem) {
  contextMenu.show = true; contextMenu.x = e.clientX; contextMenu.y = e.clientY; contextMenu.bookId = book.id
  document.addEventListener('click', () => { contextMenu.show = false }, { once: true })
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
  if (!confirm('确定删除这本书？')) return
  try {
    await $fetch('/api/text/delete', { method: 'POST', body: { id: contextMenu.bookId } })
    contextMenu.show = false; await loadBooks()
  } catch (e: any) {}
}

// 弹窗内上传/粘贴
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

watch(activeFolder, loadBooks)
onMounted(async () => { await loadFolders(); await loadBooks() })
</script>
