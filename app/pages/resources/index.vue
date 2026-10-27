<template>
  <div class="rs-page">
    <PageHeader title="资源" active="resources" back-to="/" back-label="书架">
      <template #actions>
        <NuxtLink to="/sheet/new" class="rs-hdr-link">图片试卷</NuxtLink>
        <NuxtLink to="/wordbooks" class="rs-hdr-link">单词本</NuxtLink>
      </template>
    </PageHeader>

    <div class="rs-body">
      <div class="rs-summary">
        <div class="rs-sum-item"><b>{{ loading ? '—' : resources.length }}</b><span>篇文章</span></div>
        <div class="rs-sum-item"><b>{{ loading ? '—' : totalWords }}</b><span>词条</span></div>
        <div class="rs-sum-item"><b class="rs-accent">{{ loading ? '—' : totalDue }}</b><span>待复习</span></div>
      </div>

      <div class="rs-toolbar">
        <input v-model="search" class="rs-search" type="search" placeholder="搜索文章标题…" spellcheck="false" />
        <select v-model="sortBy" class="rs-sort" aria-label="排序">
          <option value="due">待复习优先</option>
          <option value="recent">最近标记</option>
          <option value="read">最近阅读</option>
          <option value="size">词数最多</option>
        </select>
      </div>

      <div v-if="detached" class="rs-notice">
        另有 {{ detached.total }} 个词来自已删除的文章，仍保留在单词本中
      </div>

      <div class="rs-list">
        <div v-if="loading" class="rs-empty">加载中…</div>
        <div v-else-if="!visibleItems.length" class="rs-empty">
          <p v-if="search.trim()">没有匹配「{{ search.trim() }}」的文章</p>
          <p v-else>还没有带标记的文章</p>
          <p class="rs-empty-hint">阅读时标记生词，文章会自动出现在这里</p>
        </div>

        <article v-for="r in visibleItems" :key="r.id" class="rs-card">
          <button class="rs-cover" :title="r.cover ? '更换封面' : '添加封面'" @click.stop="openCover(r)">
            <img v-if="r.cover" :src="r.cover" alt="" loading="lazy" />
            <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b9b6ad" stroke-width="1.5">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
          </button>

          <div class="rs-main">
            <div class="rs-title-row">
              <h3 class="rs-title">{{ r.title }}</h3>
              <span v-if="r.due" class="rs-badge rs-badge-due">{{ r.due }} 待复习</span>
              <span v-else-if="r.pct >= 100" class="rs-badge rs-badge-done">已掌握</span>
            </div>
            <div class="rs-meta">
              {{ r.total }} 词 · {{ r.pct }}%
              <template v-if="r.readCount"> · 读过 {{ r.readCount }} 次</template>
              <template v-if="r.lastMarkedAt"> · 最近标记 {{ fmtDate(r.lastMarkedAt) }}</template>
            </div>
            <div class="rs-progress"><i :style="{ width: r.pct + '%' }"></i></div>
          </div>

          <div class="rs-actions">
            <button class="rs-btn rs-btn-primary" @click.stop="openRead(r)">读原文</button>
            <button class="rs-btn" @click.stop="openWords(r)">生词</button>
          </div>
        </article>

        <button v-if="sorted.length > visibleItems.length" class="rs-more" @click="visible += 20">
          加载更多 · 还有 {{ sorted.length - visibleItems.length }} 篇
        </button>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="cover.open" class="rs-modal-overlay" @click.self="closeCover">
        <div class="rs-modal">
          <div class="rs-modal-head">
            <h3 class="rs-modal-title">设置封面</h3>
            <button class="rs-modal-close" @click="closeCover">×</button>
          </div>
          <p class="rs-modal-subject">{{ cover.resource?.title }}</p>

          <div class="rs-modal-actions">
            <label class="rs-upload">
              上传图片
              <input type="file" accept="image/*" hidden @change="onCoverFile" />
            </label>
            <button class="rs-btn" :disabled="cover.loading" @click="pickCover">
              {{ cover.loading ? '处理中…' : '智能取图' }}
            </button>
            <button v-if="cover.resource?.cover" class="rs-btn" @click="removeCover">移除</button>
          </div>

          <p v-if="cover.error" class="rs-modal-error">{{ cover.error }}</p>

          <div v-if="cover.candidates.length" class="rs-cover-grid">
            <button v-for="(c, i) in cover.candidates" :key="c.full" class="rs-cover-cell" @click="applyCandidate(c, i)">
              <img
                :src="thumbSrc(c.thumb)"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
                @error="onThumbError(c.thumb)"
              />
              <span v-if="cover.busy === i" class="rs-cover-busy">应用中…</span>
            </button>
          </div>
          <p v-else class="rs-modal-hint">上传本地图片，或用文章标题智能搜图；封面会保存在自己的存储里。</p>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { compressImageFile } from '~/utils/imageCompress'

useHead({ title: '资源' })

interface Resource {
  id: string
  title: string
  total: number
  due: number
  pct: number
  cover: string
  readCount: number
  lastReadAt: string
  lastMarkedAt: string
}

const resources = ref<Resource[]>([])
const detached = ref<{ total: number } | null>(null)
const loading = ref(true)
const search = ref('')
const sortBy = ref<'due' | 'recent' | 'read' | 'size'>('due')
const visible = ref(20)

interface CoverCandidate { thumb: string; full: string }
const cover = reactive({
  open: false,
  resource: null as Resource | null,
  loading: false,
  busy: -1,
  error: '',
  candidates: [] as CoverCandidate[],
})

const totalWords = computed(() => resources.value.reduce((a, r) => a + r.total, 0))
const totalDue = computed(() => resources.value.reduce((a, r) => a + r.due, 0))

const sorted = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = q ? resources.value.filter(r => r.title.toLowerCase().includes(q)) : [...resources.value]
  const byTime = (v: string) => (v ? new Date(v).getTime() : 0)
  switch (sortBy.value) {
    case 'recent': return list.sort((a, b) => byTime(b.lastMarkedAt) - byTime(a.lastMarkedAt))
    case 'read': return list.sort((a, b) => byTime(b.lastReadAt) - byTime(a.lastReadAt))
    case 'size': return list.sort((a, b) => b.total - a.total)
    default: return list.sort((a, b) => b.due - a.due || byTime(b.lastMarkedAt) - byTime(a.lastMarkedAt))
  }
})

const visibleItems = computed(() => sorted.value.slice(0, visible.value))

watch([search, sortBy], () => { visible.value = 20 })

function pct(mastered: number, total: number) {
  return total > 0 ? Math.min(100, Math.round((mastered / total) * 100)) : 0
}

function fmtDate(v: string) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`
}

function openRead(r: Resource) {
  navigateTo(`/read/${r.id}`)
}

function openWords(r: Resource) {
  navigateTo(`/wordbooks/book/${r.id}`)
}

// ── 封面 ──
function proxy(u: string) {
  return `/api/images/proxy?url=${encodeURIComponent(u)}`
}

/** 缩略图直连优先，防盗链站点失败后回退服务端代理（避免整屏等待） */
const thumbFallback = reactive<Record<string, boolean>>({})
function thumbSrc(u: string) {
  return thumbFallback[u] ? proxy(u) : u
}
function onThumbError(u: string) {
  if (!thumbFallback[u]) thumbFallback[u] = true
}

function openCover(r: Resource) {
  cover.open = true
  cover.resource = r
  cover.error = ''
  cover.candidates = []
  cover.busy = -1
}

function closeCover() {
  cover.open = false
  cover.resource = null
  cover.candidates = []
}

async function onCoverFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !cover.resource) return
  cover.loading = true; cover.error = ''
  try {
    const compressed = await compressImageFile(file, { maxEdge: 1200, quality: 0.82 })
    const form = new FormData()
    form.append('file', compressed, (compressed as File).name || 'cover.webp')
    const res = await $fetch<{ url: string }>(`/api/resources/${cover.resource.id}/cover`, { method: 'POST', body: form })
    cover.resource.cover = res.url
  } catch (err: any) {
    cover.error = err?.data?.message || '上传失败'
  } finally {
    cover.loading = false
    input.value = ''
  }
}

async function pickCover() {
  if (!cover.resource) return
  cover.loading = true; cover.error = ''
  try {
    const res = await $fetch<{ candidates: CoverCandidate[]; error?: string }>('/api/images/search', {
      query: { q: cover.resource.title, count: 6, expand: 1 },
    })
    cover.candidates = res.candidates || []
    if (!cover.candidates.length) cover.error = res.error || '没有找到合适的图片，换个方式上传吧'
  } catch {
    cover.error = '取图失败，可改用手动上传'
  } finally {
    cover.loading = false
  }
}

async function applyCandidate(c: CoverCandidate, i: number) {
  if (!cover.resource) return
  cover.busy = i; cover.error = ''
  try {
    const imported = await $fetch<{ url: string }>('/api/images/import', {
      method: 'POST',
      body: { url: c.full, textId: cover.resource.id },
    })
    const res = await $fetch<{ url: string }>(`/api/resources/${cover.resource.id}/cover`, {
      method: 'POST',
      body: { url: imported.url },
    })
    cover.resource.cover = res.url
    cover.candidates = []
  } catch (err: any) {
    cover.error = err?.data?.message || '设置失败'
  } finally {
    cover.busy = -1
  }
}

async function removeCover() {
  if (!cover.resource) return
  try {
    await $fetch(`/api/resources/${cover.resource.id}/cover`, { method: 'DELETE' })
    cover.resource.cover = ''
  } catch {
    cover.error = '移除失败'
  }
}

async function load() {
  loading.value = true
  try {
    const rows = await $fetch<any[]>('/api/wordbooks/books')
    const list: Resource[] = []
    let detachedRow: any = null

    for (const b of rows) {
      if (b.id === '__detached__') { detachedRow = b; continue }
      if (b.id === '__orphan__') continue
      const total = Number(b.totalCount) || 0
      const mastered = Number(b.masteredCount) || 0
      list.push({
        id: b.id,
        title: b.title || '未命名',
        total,
        due: Number(b.dueCount) || 0,
        pct: pct(mastered, total),
        cover: b.cover || '',
        readCount: Number(b.readCount) || 0,
        lastReadAt: b.lastReadAt || '',
        lastMarkedAt: b.lastMarkedAt || '',
      })
    }

    resources.value = list
    detached.value = detachedRow ? { total: Number(detachedRow.totalCount) || 0 } : null
  } catch {}
  loading.value = false
}

onMounted(load)
</script>

<style scoped>
.rs-page { height: 100vh; display: flex; flex-direction: column; overflow: hidden; background: #f7f6f3; }
.rs-hdr-link { font-size: 12px; color: #6b6963; text-decoration: none; padding: 5px 10px; border: 0.5px solid rgba(0,0,0,0.1); border-radius: 7px; }
.rs-hdr-link:hover { color: #3d3591; background: #f0efe9; }

.rs-body { flex: 1; overflow-y: auto; max-width: 680px; width: 100%; margin: 0 auto; }

.rs-summary { display: flex; margin: 14px 20px 0; padding: 14px 0; background: #fff; border: 0.5px solid rgba(0,0,0,0.07); border-radius: 12px; }
.rs-sum-item { flex: 1; text-align: center; position: relative; }
.rs-sum-item + .rs-sum-item::before { content: ''; position: absolute; left: 0; top: 4px; bottom: 4px; width: 0.5px; background: rgba(0,0,0,0.07); }
.rs-sum-item b { display: block; font-size: 20px; font-weight: 500; color: #1a1a18; line-height: 1.2; font-family: 'DM Sans', sans-serif; }
.rs-sum-item b.rs-accent { color: #3d3591; }
.rs-sum-item span { font-size: 11.5px; color: #a09e97; font-family: 'DM Sans', sans-serif; }

.rs-toolbar { display: flex; gap: 8px; padding: 12px 20px 0; }
.rs-search {
  flex: 1; min-width: 0; padding: 8px 11px; border: 0.5px solid rgba(0,0,0,0.12); border-radius: 8px;
  font-size: 12.5px; font-family: 'DM Sans', sans-serif; background: #fff; outline: none; color: #334155;
}
.rs-search:focus { border-color: #3d3591; }
.rs-sort {
  padding: 7px 8px; border-radius: 8px; border: 0.5px solid rgba(0,0,0,0.12);
  background: #fff; font-size: 11.5px; color: #5f5e5a; font-family: 'DM Sans', sans-serif; outline: none;
}

.rs-notice {
  margin: 10px 20px 0; padding: 8px 11px; border-radius: 8px; background: #fdf6e3;
  border: 0.5px solid rgba(186,117,23,0.25); color: #854f0b; font-size: 11.5px;
  line-height: 1.5; font-family: 'DM Sans', sans-serif;
}

.rs-list { padding: 10px 20px 40px; display: flex; flex-direction: column; gap: 8px; }
.rs-card {
  display: flex; align-items: center; gap: 12px; background: #fff; padding: 11px 12px;
  border: 0.5px solid rgba(0,0,0,0.07); border-radius: 12px;
}
.rs-cover {
  width: 54px; height: 54px; flex-shrink: 0; border-radius: 8px; overflow: hidden;
  background: #f1efe8; display: flex; align-items: center; justify-content: center;
  padding: 0; border: 0.5px solid rgba(0,0,0,0.06); cursor: pointer;
}
.rs-cover:hover { border-color: rgba(61,53,145,0.35); }
.rs-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.rs-main { flex: 1; min-width: 0; }
.rs-title-row { display: flex; align-items: baseline; gap: 8px; }
.rs-title {
  flex: 1; min-width: 0; margin: 0; font-size: 13.5px; font-weight: 500; color: #1a1a18;
  font-family: 'DM Sans', sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rs-badge { flex-shrink: 0; padding: 1px 6px; border-radius: 4px; font-size: 10.5px; font-family: 'DM Sans', sans-serif; }
.rs-badge-due { color: #a32d2d; background: #fcebeb; }
.rs-badge-done { color: #0f6e56; background: #e1f5ee; }
.rs-meta { margin-top: 3px; font-size: 11px; color: #a09e97; font-family: 'DM Sans', sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rs-progress { height: 3px; margin-top: 7px; background: #eeedfe; border-radius: 2px; overflow: hidden; }
.rs-progress i { display: block; height: 3px; background: #534ab7; border-radius: 2px; }

.rs-actions { display: flex; flex-direction: column; gap: 5px; flex-shrink: 0; }
.rs-btn {
  padding: 4px 10px; border: 0.5px solid rgba(0,0,0,0.12); border-radius: 6px; background: #fff;
  font-size: 11px; color: #5f5e5a; font-family: 'DM Sans', sans-serif; cursor: pointer; white-space: nowrap;
}
.rs-btn:hover { border-color: rgba(61,53,145,0.35); color: #3d3591; }
.rs-btn-primary { background: #3d3591; border-color: #3d3591; color: #fff; }
.rs-btn-primary:hover { color: #fff; opacity: .9; }

.rs-empty { text-align: center; color: #aaa; padding: 36px 0; font-size: 13px; font-family: 'DM Sans', sans-serif; }
.rs-empty p { margin: 0 0 4px; }
.rs-empty-hint { font-size: 11.5px; color: #c3c1ba; }
.rs-more {
  margin-top: 2px; padding: 9px; width: 100%; border: 0.5px dashed rgba(0,0,0,0.14);
  border-radius: 10px; background: transparent; color: #8a8880; font-size: 12px;
  font-family: 'DM Sans', sans-serif; cursor: pointer;
}
.rs-more:hover { border-color: rgba(61,53,145,0.35); color: #3d3591; }

@media (max-width: 480px) {
  .rs-summary, .rs-toolbar, .rs-notice { margin-left: 14px; margin-right: 14px; }
  .rs-toolbar { padding-left: 0; padding-right: 0; }
  .rs-list { padding-left: 14px; padding-right: 14px; }
  .rs-actions { flex-direction: row; }
}

/* 封面弹窗 */
.rs-modal-overlay { position: fixed; inset: 0; z-index: 1200; background: rgba(0,0,0,0.32); display: flex; align-items: center; justify-content: center; padding: 20px; }
.rs-modal { width: 100%; max-width: 380px; background: #fff; border-radius: 14px; padding: 16px; }
.rs-modal-head { display: flex; align-items: center; justify-content: space-between; }
.rs-modal-title { margin: 0; font-size: 15px; font-weight: 500; color: #1a1a18; font-family: 'DM Sans', sans-serif; }
.rs-modal-close { border: none; background: none; font-size: 20px; line-height: 1; color: #aaa; cursor: pointer; padding: 2px 6px; }
.rs-modal-subject { margin: 6px 0 12px; font-size: 11.5px; color: #a09e97; font-family: 'DM Sans', sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rs-modal-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.rs-upload { padding: 5px 11px; border: 0.5px solid rgba(0,0,0,0.12); border-radius: 6px; background: #fff; font-size: 11px; color: #5f5e5a; cursor: pointer; font-family: 'DM Sans', sans-serif; }
.rs-upload:hover { border-color: rgba(61,53,145,0.35); color: #3d3591; }
.rs-modal-error { margin: 8px 0 0; font-size: 11.5px; color: #a32d2d; font-family: 'DM Sans', sans-serif; }
.rs-modal-hint { margin: 10px 0 0; font-size: 11px; color: #a09e97; line-height: 1.6; font-family: 'DM Sans', sans-serif; }
.rs-cover-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 10px; }
.rs-cover-cell { position: relative; padding: 0; border: 0.5px solid rgba(0,0,0,0.1); border-radius: 6px; overflow: hidden; aspect-ratio: 4 / 3; background: #f1efe8; cursor: pointer; }
.rs-cover-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.rs-cover-cell:hover { border-color: #3d3591; }
.rs-cover-busy { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.82); font-size: 10.5px; color: #3d3591; }
</style>
