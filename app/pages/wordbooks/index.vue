<template>
  <div class="wb-page">
    <header class="wb-header">
      <NuxtLink to="/" class="wb-back">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="15 18 9 12 15 6"/></svg>
        书架
      </NuxtLink>
      <h1 class="wb-title">单词本</h1>
      <div class="wb-header-right">
        <button class="wb-hdr-icon" @click="showCreateModal = true" title="新建单词本">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <label class="wb-hdr-icon" title="导入 TXT">
          <input type="file" accept=".txt" @change="handleImport" hidden />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        </label>
        <NuxtLink to="/wordbooks/wb_default" class="wb-hdr-icon" title="所有生词">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        </NuxtLink>
      </div>
    </header>

    <div class="wb-body">
      <!-- 按文本书籍列表 -->
      <div class="wb-list">
        <div v-if="loading" class="wb-empty">加载中…</div>
        <div v-else-if="!books.length" class="wb-empty">
          <p>还没有标记的单词</p>
          <p class="wb-empty-hint">阅读时标记生词、短语、句子后，它们会出现在这里</p>
        </div>
        <div
          v-for="book in books" :key="book.id"
          class="wb-card"
          @click="openBook(book)"
        >
          <div class="wb-card-body">
            <div class="wb-card-icon">
              <svg v-if="book.id === '__orphan__'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
              <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            </div>
            <div class="wb-card-info">
              <h3 class="wb-card-name">{{ book.title }}</h3>
              <span class="wb-card-meta">
                <span v-if="book.wordCount">单词 {{ book.wordCount }}</span>
                <span v-if="book.phraseCount"><template v-if="book.wordCount"> · </template>短语 {{ book.phraseCount }}</span>
                <span v-if="book.sentenceCount"><template v-if="book.wordCount || book.phraseCount"> · </template>句子 {{ book.sentenceCount }}</span>
                <span v-if="book.dueCount"> · {{ book.dueCount }} 待复习</span>
              </span>
            </div>
            <div class="wb-card-actions">
              <button class="wb-card-btn" @click.stop="openBook(book)">查看</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 新建单词本弹窗 -->
    <Teleport to="body">
      <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
        <div class="modal-card">
          <h3 class="modal-title">新建单词本</h3>
          <input v-model="newName" class="modal-input" placeholder="输入名称…" @keydown.enter="createBook" autofocus />
          <div class="modal-actions">
            <button class="modal-btn" @click="showCreateModal = false">取消</button>
            <button class="modal-btn modal-btn-primary" @click="createBook" :disabled="!newName.trim()">创建</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 导入弹窗 -->
    <WordbookImportModal v-if="importFile" :file="importFile" @close="importFile = null" @done="onImportDone" />
  </div>
</template>

<script setup lang="ts">
useHead({ title: '单词本' })

interface Book {
  id: string
  title: string
  totalCount: number
  wordCount: number
  phraseCount: number
  sentenceCount: number
  dueCount: number
}

const books = ref<Book[]>([])
const loading = ref(true)
const showCreateModal = ref(false)
const newName = ref('')
const importFile = ref<File | null>(null)

async function load() {
  loading.value = true
  try { books.value = await $fetch<Book[]>('/api/wordbooks/books') } catch {}
  loading.value = false
}

function openBook(b: Book) {
  navigateTo(`/wordbooks/book/${b.id}`)
}

async function createBook() {
  const n = newName.value.trim()
  if (!n) return
  await $fetch('/api/wordbooks', { method: 'POST', body: { name: n } })
  showCreateModal.value = false
  newName.value = ''
  load()
}

function handleImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) importFile.value = file
  ;(e.target as HTMLInputElement).value = ''
}

function onImportDone() {
  importFile.value = null
  load()
}

onMounted(load)
</script>

<style scoped>
.wb-page { height: 100vh; display: flex; flex-direction: column; overflow: hidden; background: #f7f6f3; }

.wb-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 20px; height: 50px; background: #fff;
  border-bottom: 0.5px solid rgba(0,0,0,0.08);
  flex-shrink: 0;
}
.wb-back { display: flex; align-items: center; gap: 4px; font-size: 13px; color: #666; text-decoration: none; font-family: 'DM Sans', sans-serif; }
.wb-title { font-size: 15px; font-weight: 600; color: #1a1a18; font-family: 'Lora', serif; }
.wb-header-right { display: flex; align-items: center; gap: 4px; }
.wb-hdr-icon { cursor: pointer; color: #888; padding: 4px; display: flex; background: none; border: none; font-family: inherit; }
.wb-hdr-icon:hover { color: #3d3591; }

.wb-body {
  flex: 1; overflow-y: auto;
  max-width: 680px; width: 100%; margin: 0 auto;
}

/* ── Modal ── */
.modal-overlay { position: fixed; inset: 0; z-index: 1100; background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; }
.modal-card { background: #fff; border-radius: 12px; padding: 24px; width: 90%; max-width: 360px; }
.modal-title { font-size: 16px; font-weight: 600; margin: 0 0 16px; font-family: 'DM Sans', sans-serif; color: #1a1a18; }
.modal-input { width: 100%; padding: 10px 14px; border: 1px solid #e0ddd5; border-radius: 8px; font-size: 15px; font-family: 'DM Sans', sans-serif; outline: none; box-sizing: border-box; }
.modal-input:focus { border-color: #3d3591; }
.modal-actions { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }
.modal-btn { padding: 8px 18px; border: 1px solid #e0ddd5; border-radius: 8px; background: #fff; cursor: pointer; font-size: 14px; font-family: 'DM Sans', sans-serif; }
.modal-btn-primary { background: #3d3591; color: #fff; border: none; }
.modal-btn-primary:disabled { opacity: 0.4; cursor: default; }

.wb-list { padding: 14px 20px 40px; display: flex; flex-direction: column; gap: 10px; }
.wb-empty { text-align: center; color: #aaa; padding: 40px 0; font-size: 14px; font-family: 'DM Sans', sans-serif; }
.wb-empty-hint { font-size: 12px; color: #ccc; margin-top: 6px; }

.wb-card { background: #fff; border-radius: 10px; cursor: pointer; transition: all 0.15s; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
.wb-card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.06); transform: translateY(-1px); }
.wb-card-body { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
.wb-card-icon { flex-shrink: 0; color: #3d3591; display: flex; }
.wb-card-info { flex: 1; min-width: 0; }
.wb-card-name { font-size: 15px; font-weight: 500; color: #1a1a18; font-family: 'DM Sans', sans-serif; margin: 0 0 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-card-meta { font-size: 12px; color: #a09e97; font-family: 'DM Sans', sans-serif; }
.wb-card-actions { flex-shrink: 0; }
.wb-card-btn { padding: 5px 14px; border: 1px solid #e0ddd5; border-radius: 6px; background: #fff; font-size: 12px; font-family: 'DM Sans', sans-serif; cursor: pointer; color: #666; }
.wb-card-btn:hover { border-color: #3d3591; color: #3d3591; }

@media (max-width: 480px) {
  .wb-header { padding: 0 14px; }
  .wb-list { padding-left: 14px; padding-right: 14px; }
}
</style>
