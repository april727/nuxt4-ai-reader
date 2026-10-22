<template>
  <div class="mr-page">
    <PageHeader title="难点词" active="marks-review" back-to="/" back-label="书架" />

    <div class="mr-top">
      <div class="mr-filters">
        <FilterChip v-model="activeType" :options="typeTabs" />
      </div>
      <div class="mr-right">
        <button class="mr-sync" @click="syncNew" :disabled="syncing" :title="'把新增标记同步进向量库'">
          {{ syncing ? '同步中…' : '同步最新' }}
        </button>
        <div class="mr-stats">
          <span class="mr-stat">{{ filtered.length }} 个</span>
          <span class="mr-stat" v-if="maxCount > 1">最多标记 {{ maxCount }} 次</span>
        </div>
      </div>
    </div>

    <div class="mr-list" v-if="filtered.length">
      <div
        v-for="(item, i) in filtered"
        :key="item.display_text"
        class="mr-row"
        :class="{ muted: item.mark_count <= 1 }"
      >
        <span class="mr-index" :class="{ top: i < 3 }">{{ i + 1 }}</span>
        <span class="mr-text" :title="item.display_text">{{ item.display_text }}</span>
        <span class="mr-type" :class="`t-${item.type}`">{{ typeLabel(item.type) }}</span>
        <span class="mr-badge" :class="{ hot: item.mark_count >= 5 }">×{{ item.mark_count }}</span>
      </div>
      <div class="mr-end">已显示全部 {{ filtered.length }} 个</div>
    </div>

    <div v-else class="mr-empty">
      <div class="mr-empty-icon">🎯</div>
      <p>暂无数据</p>
      <p class="mr-empty-hint">先在 Supabase 确认 marks_embeddings 表有数据，或先运行回填脚本</p>
    </div>
  </div>
</template>

<script setup lang="ts">
interface ReviewItem {
  display_text: string
  type: string
  mark_count: number
}

const activeType = ref('all')
const typeTabs = [
  { key: 'all', label: '全部' },
  { key: 'word', label: '单词' },
  { key: 'phrase', label: '短语' },
  { key: 'sentence', label: '句子' },
]
const items = ref<ReviewItem[]>([])
const syncing = ref(false)

function typeLabel(t: string) {
  return ({ word: '词', phrase: '短', sentence: '句' } as Record<string, string>)[t] || t
}

async function load() {
  try {
    const data = await $fetch<{ items: ReviewItem[] }>('/api/marks/review', {
      query: { limit: 500 },
    })
    items.value = data.items
  } catch {
    items.value = []
  }
}

/** 增量同步：新增标记 → 向量库 */
async function syncNew() {
  if (syncing.value) return
  syncing.value = true
  try {
    await $fetch('/api/embeddings/sync', { method: 'POST' })
    await load()
  } catch {
    // 同步失败静默，不打断用户
  } finally {
    syncing.value = false
  }
}

onMounted(load)

const filtered = computed(() =>
  activeType.value === 'all'
    ? items.value
    : items.value.filter((i) => i.type === activeType.value),
)
const maxCount = computed(() =>
  filtered.value.reduce((m, i) => Math.max(m, i.mark_count), 0),
)
</script>

<style scoped>
.mr-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #0a0a1a;
  color: #e5e5ec;
}

.mr-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid #1c1c30;
}

.mr-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mr-sync {
  font-size: 12px;
  padding: 5px 14px;
  border-radius: 8px;
  border: 1px solid #3b3b6b;
  background: #1a1a3a;
  color: #a5b4fc;
  cursor: pointer;
  transition: all 0.2s;
}
.mr-sync:hover:not(:disabled) {
  background: #2e2e5a;
  border-color: #6366f1;
}
.mr-sync:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mr-stats {
  display: flex;
  gap: 12px;
  font-size: 13px;
  color: #8b8b9c;
}
.mr-stat {
  background: #14142a;
  padding: 4px 10px;
  border-radius: 8px;
}

.mr-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  max-width: 760px;
  width: 100%;
  margin: 0 auto;
  padding: 16px 16px 24px;
}

.mr-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: #12122a;
  border: 1px solid #1e1e35;
  border-radius: 10px;
  margin-bottom: 8px;
  transition: background 0.2s;
}
.mr-row:hover {
  background: #171734;
}
.mr-row.muted {
  opacity: 0.55;
}

.mr-index {
  flex: 0 0 28px;
  text-align: center;
  font-size: 12px;
  color: #6b6b7d;
  font-weight: 600;
}
.mr-index.top {
  color: #f59e0b;
}

.mr-text {
  flex: 1;
  font-size: 15px;
  word-break: break-word;
}

.mr-type {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 6px;
  background: #1c1c30;
  color: #8b8b9c;
}
.mr-type.t-word { color: #60a5fa; background: #172a4a; }
.mr-type.t-phrase { color: #34d399; background: #0c3a2e; }
.mr-type.t-sentence { color: #c084fc; background: #2e1246; }

.mr-badge {
  flex: 0 0 auto;
  font-size: 13px;
  font-weight: 700;
  color: #e5e5ec;
  background: #2a2a4a;
  padding: 3px 10px;
  border-radius: 999px;
}
.mr-badge.hot {
  color: #fff;
  background: #dc2626;
}

.mr-end {
  text-align: center;
  padding: 24px 0;
  color: #5a5a6c;
  font-size: 12px;
}

.mr-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px 20px;
  color: #8b8b9c;
}
.mr-empty-icon { font-size: 40px; margin-bottom: 12px; }
.mr-empty-hint { font-size: 13px; color: #5a5a6c; margin-top: 6px; }
</style>
