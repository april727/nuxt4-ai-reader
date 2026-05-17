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
        <div class="lib-toolbar-left">
          <h1 class="lib-title">{{ activeFolderName }}</h1>
          <div class="lib-filter-bar">
            <button class="lib-filter-btn" :class="{ active: sourceFilter === 'all' }" @click="sourceFilter = 'all'">全部</button>
            <button class="lib-filter-btn" :class="{ active: sourceFilter === 'text' }" @click="sourceFilter = 'text'">文本</button>
            <button class="lib-filter-btn" :class="{ active: sourceFilter === 'video' }" @click="sourceFilter = 'video'">视频</button>
          </div>
        </div>
        <div class="lib-actions">
          <button class="lib-btn" @click="showVideoImport = true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
            导入视频
          </button>
          <button class="lib-btn" @click="navigateTo('/reviews')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            复习本
          </button>
          <button class="lib-btn" @click="showUpload = true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-1.5-.5"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            上传文件
          </button>
          <button class="lib-btn" @click="showUrl = true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            网址
          </button>
        </div>
      </div>

      <!-- 书本网格（支持拖入文件夹） -->
      <div v-if="filteredBooks.length > 0" class="lib-grid">
        <BookCard
          v-for="book in filteredBooks"
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
        <p v-if="sourceFilter === 'video'">暂无视频，点击「导入视频」添加</p>
        <p v-else>拖拽文件到此处，或点击上方按钮</p>
        <p v-if="sourceFilter !== 'video'" class="lib-empty-hint">支持 PDF、Markdown、TXT</p>
      </div>

      <!-- 视频导入弹窗 -->
      <VideoImportModal
        v-if="showVideoImport"
        @imported="handleVideoImported"
        @close="showVideoImport = false"
      />
    </main>

    <!-- 右键菜单 -->
    <div
      v-if="contextMenu.show"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @click.self="contextMenu.show = false"
    >
      <button @click="renameBook">重命名</button>
      <button @click="toggleComplete">{{ contextMenu.completedAt ? '取消完成' : '标记完成' }}</button>
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
useHead({ title: 'AI 阅读分析 - 书架' })

interface Folder { id: string; name: string }
interface BookItem { id: string; title: string; source: string; length: number; duration?: number; completedAt?: string }

const videoSources = ['youtube', 'bilibili', 'video_file', 'audio_file']

const activeFolder = ref('default')

// SSR 预取：数据在服务端渲染时一并获取，避免客户端空状态闪变
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

// 过滤
const sourceFilter = ref<'all' | 'text' | 'video'>('all')

const filteredBooks = computed(() => {
  if (sourceFilter.value === 'video') return books.value.filter(b => videoSources.includes(b.source))
  if (sourceFilter.value === 'text') return books.value.filter(b => !videoSources.includes(b.source) && b.source !== '')
  return books.value
})

// 右键菜单
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
  contextMenu.show = true; contextMenu.x = e.clientX; contextMenu.y = e.clientY; contextMenu.bookId = book.id; contextMenu.completedAt = book.completedAt || ''
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

// useAsyncData 的 watch: [activeFolder] 已自动处理切换文件夹时的数据重新获取
// 顶层 await useAsyncData 已处理初始化加载，无需 onMounted 数据请求

// 客户端侧边栏数量刷新（SSR 期间不执行）
onMounted(() => { counts() })
</script>
