<template>
  <div class="rb-page">
    <PageHeader title="回收站" active="recycle" back-to="/" back-label="书架">
      <template #actions>
        <button class="rb-refresh" @click="load" title="刷新">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>
        </button>
      </template>
    </PageHeader>

    <div class="rb-body">
      <div v-if="loading" class="rb-loading">加载中…</div>
      <template v-else>
        <div v-if="files.length === 0 && marks.length === 0" class="rb-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c4c1ba" stroke-width="1">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          <p>回收站是空的</p>
        </div>

        <!-- 文件/书 -->
        <template v-if="files.length">
          <div class="rb-section-title">书籍 / 文件 <span class="rb-count">{{ files.length }}</span></div>
          <div class="rb-list">
            <div v-for="f in files" :key="f.id" class="rb-item">
              <div class="rb-main">
                <div class="rb-text">{{ f.title }}</div>
                <div class="rb-meta">
                  <span class="rb-type rb-type-file">{{ sourceLabel(f.source) }}</span>
                  <span class="rb-time">删除于 {{ fmtTime(f.deletedAt) }}</span>
                </div>
              </div>
              <div class="rb-actions">
                <button class="rb-restore" @click="restoreFile(f)" title="恢复文件">恢复</button>
                <button class="rb-del" @click="permanentFile(f)" title="彻底删除">彻底删除</button>
              </div>
            </div>
          </div>
        </template>

        <!-- 标记 -->
        <template v-if="marks.length">
          <div class="rb-section-title">标记 <span class="rb-count">{{ marks.length }}</span></div>
          <div class="rb-list">
            <div v-for="m in marks" :key="m.id" class="rb-item">
              <div class="rb-main">
                <div class="rb-text">{{ m.text }}</div>
                <div class="rb-meta">
                  <span class="rb-type" :style="{ color: typeColor(m.type) }">{{ typeLabel(m.type) }}</span>
                  <span class="rb-source">《{{ m.textTitle || '未命名' }}》</span>
                  <span class="rb-time">删除于 {{ fmtTime(m.deletedAt) }}</span>
                </div>
              </div>
              <div class="rb-actions">
                <button class="rb-restore" @click="restoreMark(m)" title="恢复标记">恢复</button>
                <button class="rb-del" @click="permanentMark(m)" title="彻底删除">彻底删除</button>
              </div>
            </div>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
useHead({ title: '回收站' })

interface RecycleFile {
  id: string
  title: string
  source: string
  folder: string
  excerpt: string
  createdAt: string
  deletedAt: string
}
interface RecycleMark {
  id: string
  text: string
  type: string
  lemma: string
  detail: string
  note: string
  textId: string
  textTitle: string
  textFolder: string
  createdAt: string
  deletedAt: string
}

const files = ref<RecycleFile[]>([])
const marks = ref<RecycleMark[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const data = await $fetch<{ files: RecycleFile[]; marks: RecycleMark[] }>('/api/recycle/list')
    files.value = data.files || []
    marks.value = data.marks || []
  } catch {}
  loading.value = false
}
onMounted(load)

function typeLabel(t: string): string {
  return ({ word: '生词', phrase: '短语', sentence: '句子', note: '摘抄' } as any)[t] || t
}
function typeColor(t: string): string {
  return ({ word: '#f59e0b', phrase: '#10b981', sentence: '#06b6d4', note: '#f9a8d4' } as any)[t] || '#a09e97'
}
function sourceLabel(source: string): string {
  if (!source) return '文本'
  if (source === 'youtube') return 'YouTube'
  if (source === 'bilibili') return 'B站'
  if (source === 'audio_file') return '音频'
  if (source === 'video_file') return '视频'
  if (source === 'paste') return '粘贴'
  if (source.startsWith('http')) return '网页'
  return '文本'
}
function fmtTime(t?: string): string {
  if (!t) return ''
  const d = new Date(t)
  return `${d.toLocaleDateString('zh-CN')} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}

async function restoreFile(f: RecycleFile) {
  try {
    await $fetch('/api/recycle/restore', { method: 'POST', body: { id: f.id, kind: 'text' } })
    files.value = files.value.filter(x => x.id !== f.id)
  } catch {}
}
async function permanentFile(f: RecycleFile) {
  if (!confirm(`彻底删除《${f.title}》？此操作不可恢复。`)) return
  try {
    await $fetch('/api/recycle/permanent', { method: 'POST', body: { id: f.id, kind: 'text' } })
    files.value = files.value.filter(x => x.id !== f.id)
  } catch {}
}
async function restoreMark(m: RecycleMark) {
  try {
    await $fetch('/api/recycle/restore', { method: 'POST', body: { id: m.id, kind: 'mark' } })
    marks.value = marks.value.filter(x => x.id !== m.id)
  } catch {}
}
async function permanentMark(m: RecycleMark) {
  if (!confirm(`彻底删除「${m.text}」？此操作不可恢复。`)) return
  try {
    await $fetch('/api/recycle/permanent', { method: 'POST', body: { id: m.id, kind: 'mark' } })
    marks.value = marks.value.filter(x => x.id !== m.id)
  } catch {}
}
</script>

<style scoped>
.rb-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f7f6f3;
}
.rb-refresh {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 8px;
  background: #fff;
  color: #6b6963;
  cursor: pointer;
  transition: all 0.12s;
}
.rb-refresh:hover {
  color: #3d3591;
  border-color: rgba(61,53,145,0.25);
}
.rb-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 28px 60px;
  max-width: 760px;
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
}
.rb-loading,
.rb-empty {
  text-align: center;
  color: #a09e97;
  padding: 60px 20px;
  font-size: 14px;
}
.rb-empty svg {
  display: block;
  margin: 0 auto 12px;
}
.rb-section-title {
  font-size: 12px;
  font-weight: 600;
  color: #6b6963;
  letter-spacing: 0.04em;
  margin: 18px 0 10px;
}
.rb-section-title:first-child { margin-top: 0; }
.rb-count {
  margin-left: 6px;
  color: #a09e97;
  font-weight: 400;
  font-family: 'DM Mono', monospace;
}
.rb-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rb-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.07);
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.rb-main {
  min-width: 0;
}
.rb-text {
  font-family: 'Lora', Georgia, serif;
  font-size: 14px;
  color: #1a1a18;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rb-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
  font-size: 11.5px;
  color: #a09e97;
}
.rb-type {
  font-weight: 600;
}
.rb-type-file {
  color: #3d3591;
}
.rb-source {
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rb-time {
  font-family: 'DM Mono', monospace;
  flex-shrink: 0;
}
.rb-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.rb-restore,
.rb-del {
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid rgba(0,0,0,0.1);
  background: #fff;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.12s;
}
.rb-restore {
  color: #3d3591;
}
.rb-restore:hover {
  background: #f0eefb;
  border-color: rgba(61,53,145,0.25);
}
.rb-del {
  color: #dc2626;
}
.rb-del:hover {
  background: #fef2f2;
  border-color: rgba(220,38,38,0.25);
}

@media (max-width: 600px) {
  .rb-body {
    padding: 14px 12px 40px;
  }
  .rb-item {
    flex-direction: column;
    align-items: flex-start;
  }
  .rb-actions {
    width: 100%;
  }
  .rb-restore,
  .rb-del {
    flex: 1;
    text-align: center;
  }
}
</style>
