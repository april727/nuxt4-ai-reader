<template>
  <div class="cl-page">
    <PageHeader title="语义分组" active="marks-clusters" back-to="/" back-label="书架" />

    <div class="cl-top">
      <div class="cl-filters">
        <FilterChip v-model="activeType" :options="typeTabs" />
        <div class="cl-min">
          <button class="cl-min-btn" :class="{ active: minCount === 1 }" @click="setMinCount(1)">全部</button>
          <button class="cl-min-btn" :class="{ active: minCount === 2 }" @click="setMinCount(2)">仅重点(≥2次)</button>
        </div>
        <div class="cl-threshold">
          <label class="cl-t-label">相似度</label>
          <input type="range" min="0.5" max="0.9" step="0.05" v-model.number="threshold" @change="reload" />
          <span class="cl-t-value">{{ threshold.toFixed(2) }}</span>
        </div>
      </div>
      <div class="cl-right">
        <button class="cl-sync" @click="syncNew" :disabled="syncing" title="把新增标记同步进向量库">
          {{ syncing ? '同步中…' : '同步最新' }}
        </button>
        <div class="cl-stats" v-if="total">
          <span>{{ total }} 个</span>
          <span>{{ clusters.length }} 组</span>
        </div>
      </div>
    </div>

    <div class="cl-grid" v-if="clusters.length">
      <section v-for="c in clusters" :key="c.id" class="cl-card">
        <header class="cl-card-head">
          <span class="cl-label">{{ c.label }}</span>
          <span class="cl-meta">{{ c.size }} 词 · 标记 {{ c.totalMarks }} 次</span>
        </header>
        <div class="cl-items">
          <div v-for="item in c.items" :key="item.display_text" class="cl-item">
            <span class="cl-word" :title="item.display_text">{{ item.display_text }}</span>
            <span class="cl-count" :class="{ hot: item.mark_count >= 3 }">×{{ item.mark_count }}</span>
          </div>
        </div>
      </section>
    </div>

    <div v-else class="cl-empty">
      <div class="cl-empty-icon">🧩</div>
      <p>{{ loading ? '正在分组…' : '暂无数据' }}</p>
      <p class="cl-empty-hint" v-if="!loading">先在 Supabase 确认 marks_embeddings 有数据，或先运行回填脚本</p>
    </div>
  </div>
</template>

<script setup lang="ts">
interface ClusterItem {
  display_text: string
  type: string
  mark_count: number
}
interface Cluster {
  id: number
  size: number
  totalMarks: number
  label: string
  items: ClusterItem[]
}

const activeType = ref('all')
const threshold = ref(0.7)
const minCount = ref(2)
const clusters = ref<Cluster[]>([])
const total = ref(0)
const loading = ref(false)
const syncing = ref(false)

const typeTabs = [
  { key: 'all', label: '全部' },
  { key: 'word', label: '单词' },
  { key: 'phrase', label: '短语' },
  { key: 'sentence', label: '句子' },
]

async function reload() {
  loading.value = true
  try {
    const data = await $fetch<{ clusters: Cluster[]; total: number }>('/api/marks/clusters', {
      query: {
        threshold: threshold.value,
        type: activeType.value,
        minCount: minCount.value,
      },
    })
    clusters.value = data.clusters
    total.value = data.total
  } catch {
    clusters.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

/** 增量同步：新增标记 → 向量库 */
async function syncNew() {
  if (syncing.value) return
  syncing.value = true
  try {
    await $fetch('/api/embeddings/sync', { method: 'POST' })
    await reload()
  } catch {
    // 同步失败静默
  } finally {
    syncing.value = false
  }
}

function setMinCount(v: number) {
  minCount.value = v
  reload()
}

watch(activeType, reload)
onMounted(reload)
</script>

<style scoped>
.cl-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #0a0a1a;
  color: #e5e5ec;
}

.cl-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid #1c1c30;
}

.cl-filters {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}

.cl-min {
  display: flex;
  gap: 6px;
}
.cl-min-btn {
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 8px;
  background: #14142a;
  border: 1px solid #26264a;
  color: #8b8b9c;
  cursor: pointer;
  transition: all 0.2s;
}
.cl-min-btn.active {
  background: #2e2e5a;
  border-color: #6366f1;
  color: #a5b4fc;
  font-weight: 600;
}

.cl-threshold {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #8b8b9c;
}
.cl-t-value {
  min-width: 32px;
  color: #e5e5ec;
  font-weight: 600;
}
.cl-threshold input[type='range'] {
  width: 110px;
  accent-color: #6366f1;
}

.cl-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.cl-sync {
  font-size: 12px;
  padding: 5px 14px;
  border-radius: 8px;
  border: 1px solid #3b3b6b;
  background: #1a1a3a;
  color: #a5b4fc;
  cursor: pointer;
  transition: all 0.2s;
}
.cl-sync:hover:not(:disabled) {
  background: #2e2e5a;
  border-color: #6366f1;
}
.cl-sync:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cl-stats {
  display: flex;
  gap: 12px;
  font-size: 13px;
  color: #8b8b9c;
}
.cl-stats span {
  background: #14142a;
  padding: 4px 10px;
  border-radius: 8px;
}

.cl-grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
  padding: 16px 20px 24px;
  max-width: 1400px;
  width: 100%;
  margin: 0 auto;
  align-content: start;
}

.cl-card {
  background: #12122a;
  border: 1px solid #1e1e35;
  border-radius: 12px;
  padding: 14px;
  transition: border-color 0.2s;
}
.cl-card:hover {
  border-color: #33335a;
}

.cl-card-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid #1c1c30;
}
.cl-label {
  font-weight: 700;
  font-size: 15px;
  color: #a5b4fc;
}
.cl-meta {
  font-size: 11px;
  color: #6b6b7d;
  white-space: nowrap;
}

.cl-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cl-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #1a1a38;
  border: 1px solid #26264a;
  border-radius: 7px;
  padding: 4px 9px;
  font-size: 13px;
}
.cl-word {
  word-break: break-word;
}
.cl-count {
  font-size: 11px;
  color: #8b8b9c;
  font-weight: 700;
}
.cl-count.hot {
  color: #f59e0b;
}

.cl-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px 20px;
  color: #8b8b9c;
}
.cl-empty-icon { font-size: 40px; margin-bottom: 12px; }
.cl-empty-hint { font-size: 13px; color: #5a5a6c; margin-top: 6px; }
</style>
