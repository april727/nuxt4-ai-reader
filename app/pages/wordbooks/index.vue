<template>
  <div class="wb-page">
    <PageHeader title="单词本" active="wordbooks" back-to="/" back-label="书架">
      <template #actions>
        <NuxtLink to="/wordbooks/repeat" class="wb-hdr-text">重点攻克</NuxtLink>
        <NuxtLink to="/resources" class="wb-hdr-text">资源</NuxtLink>
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
      </template>
    </PageHeader>

    <div class="wb-body">
      <!-- 总览 -->
      <div class="wb-overview">
        <div class="wb-ov-row">
          <div class="wb-ov-item">
            <b class="wb-ov-num wb-accent">{{ loading ? '—' : overview.due }}</b>
            <span>待复习</span>
          </div>
          <div class="wb-ov-item">
            <b class="wb-ov-num">{{ loading ? '—' : overview.fresh }}</b>
            <span>新词</span>
          </div>
          <div class="wb-ov-item">
            <b class="wb-ov-num">{{ loading ? '—' : overview.mastered }}</b>
            <span>已掌握</span>
          </div>
        </div>
        <button class="wb-start" :disabled="loading || !pendingTotal" @click="startLearning">
          {{ loading ? '加载中…' : `开始学习 · ${pendingTotal} 张` }}
        </button>
      </div>

      <!-- 分组切换 -->
      <div class="wb-tabs">
        <button
          v-for="t in tabs" :key="t.key"
          class="wb-tab" :class="{ active: tab === t.key }"
          @click="tab = t.key"
        >{{ t.label }}</button>
      </div>

      <div class="wb-search-row">
        <input v-model="search" class="wb-search" type="search" placeholder="搜索分组…" spellcheck="false" />
      </div>

      <div class="wb-list">
        <div v-if="loading" class="wb-empty">加载中…</div>
        <div v-else-if="!groups.length" class="wb-empty">
          <p v-if="search.trim()">没有匹配「{{ search.trim() }}」的分组</p>
          <p v-else-if="tab === 'custom'">还没有自定义分组</p>
          <p v-else>还没有单词本</p>
          <p class="wb-empty-hint">
            {{ tab === 'custom' ? '点右上角 + 新建一个分组' : '阅读标记会自动汇总到这里' }}
          </p>
          <button v-if="tab === 'custom'" class="wb-empty-btn" @click="showCreateModal = true">新建分组</button>
        </div>

        <button
          v-for="g in visibleGroups" :key="g.kind + g.id"
          class="wb-card" @click="openGroup(g)"
        >
          <div class="wb-card-top">
            <h3 class="wb-card-name">{{ g.title }}</h3>
            <span v-if="g.due" class="wb-badge wb-badge-due">{{ g.due }} 待复习</span>
            <span v-else-if="g.fresh" class="wb-badge wb-badge-new">{{ g.fresh }} 新词</span>
            <span v-else-if="g.total && g.pct >= 100" class="wb-badge wb-badge-done">已掌握</span>
          </div>
          <div class="wb-progress"><i :style="{ width: g.pct + '%' }"></i></div>
          <div class="wb-card-foot">
            <span>
              {{ g.total }} 词 · {{ g.pct }}%<template v-if="g.readCount"> · 读过 {{ g.readCount }} 次</template>
            </span>
            <span class="wb-card-link">查看</span>
          </div>
        </button>

        <button
          v-if="groups.length > visibleGroups.length"
          class="wb-more"
          @click="visible += 20"
        >加载更多 · 还有 {{ groups.length - visibleGroups.length }} 组</button>
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

interface Group {
  id: string
  title: string
  total: number
  mastered: number
  due: number
  fresh: number
  pct: number
  href: string
  kind: 'article' | 'collection'
  isDefault?: number
  readCount?: number
  lastReadAt?: string
}

const collections = ref<Group[]>([])
const loading = ref(true)
const tab = ref<'all' | 'custom'>('all')
const search = ref('')
const showCreateModal = ref(false)
const newName = ref('')
const importFile = ref<File | null>(null)

const tabs = [
  { key: 'all' as const, label: '全部' },
  { key: 'custom' as const, label: '我的分组' },
]

function pct(mastered: number, total: number) {
  return total > 0 ? Math.min(100, Math.round((mastered / total) * 100)) : 0
}

const overview = computed(() => collections.value.reduce(
  (acc, g) => ({ due: acc.due + g.due, fresh: acc.fresh + g.fresh, mastered: acc.mastered + g.mastered }),
  { due: 0, fresh: 0, mastered: 0 },
))

const pendingTotal = computed(() => overview.value.due + overview.value.fresh)

const customCollections = computed(() => collections.value.filter(g => !g.isDefault))

const groups = computed(() => {
  const list = tab.value === 'all' ? collections.value : customCollections.value
  const q = search.value.trim().toLowerCase()
  return q ? list.filter(g => g.title.toLowerCase().includes(q)) : list
})

// 文章分组可能上百个，分批渲染
const visible = ref(20)
const visibleGroups = computed(() => groups.value.slice(0, visible.value))
watch([tab, search], () => { visible.value = 20 })

async function load() {
  loading.value = true
  try {
    const cRows = await $fetch<any[]>('/api/wordbooks')

    collections.value = cRows.map((b) => {
      const total = Number(b.wordCount) || 0
      const mastered = Number(b.masteredCount) || 0
      return {
        id: b.id,
        title: b.name,
        total,
        mastered,
        due: Number(b.dueCount) || 0,
        fresh: Number(b.newCount) || 0,
        pct: pct(mastered, total),
        href: `/wordbooks/${b.id}`,
        kind: 'collection' as const,
        isDefault: Number(b.isDefault) || 0,
      }
    })
  } catch {}
  loading.value = false
}

function openGroup(g: Group) {
  navigateTo(g.href)
}

function startLearning() {
  navigateTo('/wordbooks/all/cards?type=mixed')
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
.wb-hdr-icon { cursor: pointer; color: #888; padding: 4px; display: flex; background: none; border: none; font-family: inherit; }
.wb-hdr-icon:hover { color: #3d3591; }
.wb-hdr-text {
  font-size: 12px; color: #6b6963; text-decoration: none; padding: 5px 10px;
  border: 0.5px solid rgba(0,0,0,0.1); border-radius: 7px; font-family: 'DM Sans', sans-serif;
}
.wb-hdr-text:hover { color: #3d3591; background: #f0efe9; }

.wb-body { flex: 1; overflow-y: auto; max-width: 680px; width: 100%; margin: 0 auto; }

/* 总览 */
.wb-overview { margin: 14px 20px 0; }
.wb-ov-row { display: flex; padding: 14px 0; background: #fff; border: 0.5px solid rgba(0,0,0,0.07); border-radius: 12px; }
.wb-ov-item { flex: 1; text-align: center; position: relative; }
.wb-ov-item + .wb-ov-item::before { content: ''; position: absolute; left: 0; top: 4px; bottom: 4px; width: 0.5px; background: rgba(0,0,0,0.07); }
.wb-ov-num { display: block; font-size: 20px; font-weight: 500; color: #1a1a18; line-height: 1.2; font-family: 'DM Sans', sans-serif; }
.wb-ov-num.wb-accent { color: #3d3591; }
.wb-ov-item span { font-size: 11.5px; color: #a09e97; font-family: 'DM Sans', sans-serif; }
.wb-start {
  width: 100%; margin-top: 10px; padding: 11px; border: none; border-radius: 10px;
  background: #3d3591; color: #fff; font-size: 13.5px; font-weight: 500;
  font-family: 'DM Sans', sans-serif; cursor: pointer; transition: opacity .15s;
}
.wb-start:disabled { background: #d9d6cf; cursor: default; }

/* 分组切换 */
.wb-tabs { display: flex; gap: 18px; margin: 16px 20px 0; border-bottom: 0.5px solid rgba(0,0,0,0.08); }
.wb-tab {
  padding: 0 0 8px; border: none; background: none; cursor: pointer;
  font-size: 12.5px; color: #8a8880; font-family: 'DM Sans', sans-serif;
  border-bottom: 2px solid transparent; transition: all .12s;
}
.wb-tab.active { color: #3d3591; border-bottom-color: #3d3591; font-weight: 500; }

.wb-search-row { padding: 10px 20px 0; }
.wb-notice {
  margin: 12px 20px 0; padding: 8px 11px; border-radius: 8px;
  background: #fdf6e3; border: 0.5px solid rgba(186,117,23,0.25);
  color: #854f0b; font-size: 11.5px; line-height: 1.5; font-family: 'DM Sans', sans-serif;
}.wb-search {
  width: 100%; padding: 8px 11px; border: 0.5px solid rgba(0,0,0,0.12); border-radius: 8px;
  font-size: 12.5px; font-family: 'DM Sans', sans-serif; background: #fff; outline: none; color: #334155;
  box-sizing: border-box;
}
.wb-search:focus { border-color: #3d3591; }

/* 分组卡片 */
.wb-list { padding: 10px 20px 40px; display: flex; flex-direction: column; gap: 8px; }
.wb-card {
  display: block; width: 100%; text-align: left; background: #fff; cursor: pointer;
  border: 0.5px solid rgba(0,0,0,0.07); border-radius: 12px; padding: 12px 14px;
  font-family: inherit; transition: border-color .15s;
}
.wb-card:hover { border-color: rgba(61,53,145,0.35); }
.wb-card-top { display: flex; align-items: baseline; gap: 8px; }
.wb-card-name {
  flex: 1; min-width: 0; margin: 0; font-size: 13.5px; font-weight: 500; color: #1a1a18;
  font-family: 'DM Sans', sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.wb-badge { flex-shrink: 0; padding: 1px 6px; border-radius: 4px; font-size: 10.5px; font-family: 'DM Sans', sans-serif; }
.wb-badge-due { color: #a32d2d; background: #fcebeb; }
.wb-badge-new { color: #854f0b; background: #faeeda; }
.wb-badge-done { color: #0f6e56; background: #e1f5ee; }
.wb-progress { height: 4px; margin: 9px 0 7px; background: #eeedfe; border-radius: 2px; overflow: hidden; }
.wb-progress i { display: block; height: 4px; background: #534ab7; border-radius: 2px; transition: width .2s; }
.wb-card-foot { display: flex; justify-content: space-between; font-size: 11px; color: #a09e97; font-family: 'DM Sans', sans-serif; }
.wb-card-link { color: #3d3591; opacity: .8; }

.wb-empty { text-align: center; color: #aaa; padding: 36px 0; font-size: 13px; font-family: 'DM Sans', sans-serif; }
.wb-empty p { margin: 0 0 4px; }
.wb-empty-hint { font-size: 11.5px; color: #c3c1ba; }
.wb-empty-btn {
  margin-top: 10px; padding: 7px 16px; border: 0.5px solid rgba(61,53,145,0.3);
  background: #fff; color: #3d3591; border-radius: 7px; font-size: 12px;
  font-family: 'DM Sans', sans-serif; cursor: pointer;
}
.wb-more {
  margin-top: 2px; padding: 9px; width: 100%; border: 0.5px dashed rgba(0,0,0,0.14);
  border-radius: 10px; background: transparent; color: #8a8880; font-size: 12px;
  font-family: 'DM Sans', sans-serif; cursor: pointer;
}
.wb-more:hover { border-color: rgba(61,53,145,0.35); color: #3d3591; }

/* Modal 保持原样 */
.modal-overlay { position: fixed; inset: 0; z-index: 1100; background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; }
.modal-card { background: #fff; border-radius: 12px; padding: 24px; width: 90%; max-width: 360px; }
.modal-title { font-size: 16px; font-weight: 600; margin: 0 0 16px; font-family: 'DM Sans', sans-serif; color: #1a1a18; }
.modal-input { width: 100%; padding: 10px 14px; border: 1px solid #e0ddd5; border-radius: 8px; font-size: 15px; font-family: 'DM Sans', sans-serif; outline: none; box-sizing: border-box; }
.modal-input:focus { border-color: #3d3591; }
.modal-actions { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }
.modal-btn { padding: 8px 18px; border: 1px solid #e0ddd5; border-radius: 8px; background: #fff; cursor: pointer; font-size: 14px; font-family: 'DM Sans', sans-serif; }
.modal-btn-primary { background: #3d3591; color: #fff; border: none; }
.modal-btn-primary:disabled { opacity: 0.4; cursor: default; }

@media (max-width: 480px) {
  .wb-overview, .wb-tabs, .wb-search-row { margin-left: 14px; margin-right: 14px; }
  .wb-search-row { padding-left: 0; padding-right: 0; }
  .wb-list { padding-left: 14px; padding-right: 14px; }
}
</style>
