<template>
  <div class="analysis-page">
    <!-- 顶部导航 -->
    <PageHeader title="词汇分析" active="analysis" back-to="/" back-label="书架" />

    <div class="an-body">
      <p class="an-subtitle" v-if="stats">
        {{ stats.overview.total }} 条标记 · {{ stats.overview.wordCount }} 生词 · {{ stats.overview.phraseCount }} 短语 · {{ stats.overview.sentenceCount }} 好句
      </p>

      <div v-if="loading" class="an-loading">分析中…</div>

      <template v-else-if="stats">
        <section class="an-section">
        <div class="an-section-head">
          <h2 class="an-section-title">概览</h2>
          <button
            v-if="phantomDups > 0"
            class="an-dedup-btn"
            @click="runDedup"
            :disabled="deduping"
          >
            <svg v-if="deduping" class="an-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            {{ deduping ? '清理中…' : `清理 ${phantomDups} 条重复` }}
          </button>
        </div>
        <div class="an-cards">
          <div class="an-card">
            <span class="an-card-num">{{ stats.overview.total }}</span>
            <span class="an-card-label">标记总数</span>
          </div>
          <div class="an-card accent-learn">
            <span class="an-card-num">{{ stats.overview.wordCount }}</span>
            <span class="an-card-label">生词标记</span>
          </div>
          <div class="an-card accent-review">
            <span class="an-card-num">{{ stats.overview.phraseCount }}</span>
            <span class="an-card-label">短语标记</span>
          </div>
          <div class="an-card accent-mastered">
            <span class="an-card-num">{{ stats.overview.sentenceCount }}</span>
            <span class="an-card-label">好句标记</span>
          </div>
          <div class="an-card accent-rate" v-if="stats.accuracy.attempted > 0">
            <span class="an-card-num">{{ stats.accuracy.avgRate }}%</span>
            <span class="an-card-label">正确率 ({{ stats.accuracy.attempted }}词已练习)</span>
          </div>
        </div>
      </section>

      <!-- ── 词性分布 ── -->
      <section class="an-section" v-if="stats.posDistribution.length">
        <div class="an-section-head">
          <h2 class="an-section-title">词性分布</h2>
          <button
            v-if="unlabeledCount > 0"
            class="an-enrich-btn"
            @click="runPosEnrich"
            :disabled="enriching"
          >
            <svg v-if="enriching" class="an-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            {{ enriching ? '补全中…' : `补全词性 (${unlabeledCount} 词)` }}
          </button>
        </div>
        <p class="an-section-desc" v-if="stats.posDistribution.some((p: any) => p.pos === '未标注')">
          数据与复习本一致（来自标记原文）。"未标注" 含短语、句子和未补全词性的单词。点击"补全词性"一键消除。
        </p>
        <div class="an-pos-chart">
          <div
            v-for="item in stats.posDistribution"
            :key="item.pos"
            class="an-pos-bar-wrap"
            :class="{ clickable: item.pos !== '未标注' }"
            @click="goReviewsByPos(item.pos)"
            :title="item.pos !== '未标注' ? `查看全部 ${item.pos} 词汇` : ''"
          >
            <div class="an-pos-label">{{ item.pos }}</div>
            <div class="an-pos-track">
              <div
                class="an-pos-bar"
                :style="{ width: maxPosCount ? (item.count / maxPosCount * 100) + '%' : '0%' }"
              ></div>
            </div>
            <div class="an-pos-count">{{ item.count }}</div>
          </div>
        </div>
        <!-- 进度比例条 -->
        <div class="an-pos-total-bar">
          <template v-for="item in stats.posDistribution" :key="item.pos">
            <div
              v-if="maxPosCount"
              class="an-pos-total-seg"
              :style="{ flex: item.count, background: posColors[item.pos] || '#d4d1c8' }"
              :title="`${item.pos}: ${item.count}`"
            ></div>
          </template>
        </div>
      </section>

      <!-- ── 语义聚类 & 主题推荐 (AI) ── -->
      <section class="an-section an-cluster-section">
        <div class="an-section-head">
          <h2 class="an-section-title">语义聚类 &amp; 主题推荐</h2>
          <span class="an-ai-badge">AI</span>
        </div>
        <div v-if="!clusters" class="an-cluster-empty">
          <p>AI 将分析你的全部词汇，发现语义关联，推荐适合生成内容的主题方向。</p>
          <button class="an-cluster-btn" @click="runClusterAnalysis" :disabled="clustering">
            <svg v-if="clustering" class="an-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            {{ clustering ? '分析中…' : '开始 AI 分析' }}
          </button>
        </div>
        <div v-else class="an-cluster-result">
          <p class="an-cluster-summary">{{ clusters.summary }}</p>
          <div class="an-cluster-groups">
            <div
              v-for="g in clusters.groups"
              :key="g.label"
              class="an-cluster-group"
              @click="applyClusterFilter(g)"
            >
              <span class="an-cluster-label">{{ g.label }}</span>
              <span class="an-cluster-words">{{ g.sampleWords?.join(', ') || '' }}</span>
              <span class="an-cluster-count">{{ g.count }} 词</span>
            </div>
          </div>
          <div v-if="clusters.themes?.length" class="an-cluster-themes">
            <h3>推荐主题方向</h3>
            <div class="an-theme-list">
              <div v-for="t in clusters.themes" :key="t.title" class="an-theme-card">
                <span class="an-theme-type">{{ t.style || '' }}</span>
                <strong>{{ t.title }}</strong>
                <p>{{ t.description }}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ── 重复标记 ── -->
      <section class="an-section" v-if="stats.duplicates.length">
        <h2 class="an-section-title">重复标记 <span class="an-section-badge">{{ stats.duplicates.length }}</span></h2>
        <p class="an-section-desc">这些词被标记了多次，可能跨不同文章，说明尚未牢固掌握</p>
        <div class="an-dup-grid">
          <div
            v-for="d in stats.duplicates"
            :key="d.word"
            class="an-dup-item"
            @click="searchWord(d.word)"
          >
            <span class="an-dup-word">{{ d.word }}</span>
            <span class="an-dup-count">×{{ d.count }}</span>
            <span class="an-dup-src" v-if="d.sources?.length">{{ d.sources.length }} 篇文章</span>
          </div>
        </div>
      </section>

      <!-- ── 困难词 ── -->
      <section class="an-section" v-if="stats.difficultWords.length">
        <h2 class="an-section-title">重点关注 <span class="an-section-badge">{{ stats.difficultWords.length }}</span></h2>
        <p class="an-section-desc">练习中正确率最低的词汇，建议优先复习</p>
        <div class="an-diff-table">
          <div class="an-diff-row an-diff-head">
            <span class="an-diff-word">词汇</span>
            <span class="an-diff-meaning">释义</span>
            <span class="an-diff-rate">正确率</span>
            <span class="an-diff-phase">状态</span>
          </div>
          <div
            v-for="d in stats.difficultWords"
            :key="d.id"
            class="an-diff-row"
            @click="searchWord(d.word)"
          >
            <span class="an-diff-word">{{ d.word }}</span>
            <span class="an-diff-meaning">{{ d.meaning || '—' }}</span>
            <span class="an-diff-rate" :class="{ low: d.correctRate < 50 }">{{ d.correctRate }}% ({{ d.learnCorrect }}/{{ d.learnTotal }})</span>
            <span class="an-diff-phase phase-badge" :class="'phase-' + d.phase">{{ phaseLabel(d.phase) }}</span>
          </div>
        </div>
      </section>

      <!-- ── 来源分布 ── -->
      <section class="an-section" v-if="stats.topSources.length">
        <h2 class="an-section-title">来源文章 Top {{ stats.topSources.length }}</h2>
        <div class="an-source-list">
          <div
            v-for="s in stats.topSources"
            :key="s.source"
            class="an-source-item"
            @click="s.source && navigateTo('/read/' + (s.source === 'ai-generated' ? '' : s.source) + '?folder=' + encodeURIComponent(s.source === 'ai-generated' ? 'AI生成' : ''))"
          >
            <span class="an-source-title">{{ s.title || '未命名文章' }}</span>
            <span class="an-source-count">{{ s.count }} 词</span>
          </div>
        </div>
      </section>
    </template>

      <div v-else class="an-loading an-error">加载失败，请刷新重试</div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Stats {
  overview: { total: number; wordCount: number; phraseCount: number; sentenceCount: number }
  accuracy: { attempted: number; avgRate: number }
  posDistribution: Array<{ pos: string; count: number }>
  phaseDistribution: Array<{ phase: string; count: number }>
  duplicates: Array<{ word: string; count: number; sources: string[] }>
  difficultWords: Array<{ id: string; word: string; phonetic: string; meaning: string; pos: string; phase: string; learnCorrect: number; learnTotal: number; learnWrong: number; correctRate: number }>
  topSources: Array<{ source: string; count: number; title: string }>
  unlabeledCount: number
  phantomDups: number
}

interface ClusterResult {
  summary: string
  groups: Array<{ label: string; count: number; sampleWords?: string[] }>
  themes?: Array<{ title: string; style?: string; description: string }>
}

const loading = ref(true)
const stats = ref<Stats | null>(null)

// ── 词性补全 ──
const enriching = ref(false)
const unlabeledCount = computed(() => stats.value?.unlabeledCount ?? 0)

// ── 清理重复 ──
const deduping = ref(false)
const phantomDups = computed(() => stats.value?.phantomDups ?? 0)

async function runDedup() {
  if (deduping.value || phantomDups.value === 0) return
  deduping.value = true
  try {
    const result = await $fetch<{ removed: number }>('/api/words/dedup', { method: 'POST' })
    if (result.removed > 0) {
      stats.value = await $fetch<Stats>('/api/words/stats')
    }
  } catch {
    // 失败保持按钮可见
  } finally {
    deduping.value = false
  }
}

async function runPosEnrich() {
  if (enriching.value || unlabeledCount.value === 0) return
  enriching.value = true
  try {
    const result = await $fetch<{ phrases: number; sentences: number; aiWords: number; total: number }>(
      '/api/words/enrich-all', { method: 'POST' }
    )
    if (result.total > 0) {
      // 刷新统计数据，补全完成后 unlabeledCount 归零则按钮自动消失
      stats.value = await $fetch<Stats>('/api/words/stats')
    }
  } catch {
    // 失败则按钮保持可见，用户可重试
  } finally {
    enriching.value = false
  }
}

const posColors: Record<string, string> = {
  'n.': '#6366f1',
  'v.': '#10b981',
  'adj.': '#f59e0b',
  'adv.': '#06b6d4',
  'phr.': '#ec4899',
  'sent.': '#14b8a6',
  'prep.': '#8b5cf6',
  'pron.': '#14b8a6',
  'conj.': '#f97316',
  '未标注': '#d4d1c8',
}

// 词性中文名映射
const posLabels: Record<string, string> = {
  'n.': '名词', 'v.': '动词', 'adj.': '形容词', 'adv.': '副词',
  'phr.': '短语', 'sent.': '句子', 'prep.': '介词', 'pron.': '代词', 'conj.': '连词',
}

const maxPosCount = computed(() => {
  if (!stats.value) return 0
  return Math.max(...stats.value.posDistribution.map((p: any) => p.count), 1)
})

function phaseLabel(p: string) {
  const m: Record<string, string> = { learn: '学习中', review: '复习中', mastered: '已掌握' }
  return m[p] || p
}

function searchWord(_word: string) {
  // 跳转到复习本，方便查看该词的上下文
  navigateTo('/reviews?type=word')
}

/** 按词性跳转到复习本 */
function goReviewsByPos(pos: string) {
  if (pos === '未标注') return
  navigateTo(`/reviews?type=word&pos=${encodeURIComponent(pos)}`)
}

// ── AI 聚类分析 ──
const clustering = ref(false)
const clusters = ref<ClusterResult | null>(null)

async function runClusterAnalysis() {
  if (clustering.value) return
  clustering.value = true
  try {
    const data = await $fetch<ClusterResult>('/api/words/cluster', { method: 'POST' })
    clusters.value = data
  } catch {
    // 静默失败，用户可重试
  } finally {
    clustering.value = false
  }
}

function applyClusterFilter(_g: { label: string; count: number }) {
  // 后续实现：按语义类别筛选词汇列表
}

onMounted(async () => {
  try {
    stats.value = await $fetch<Stats>('/api/words/stats')
  } catch {
    stats.value = null
  } finally {
    loading.value = false
  }
})

definePageMeta({ layout: false })
</script>

<style scoped>
.analysis-page {
  display: flex; flex-direction: column;
  height: 100vh; background: #f7f6f3;
  font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
  color: #1a1a18;
}
.an-body {
  flex: 1; overflow-y: auto;
  padding: 0 36px 60px;
  max-width: 960px; width: 100%; margin: 0 auto;
}

/* ── 顶部导航 ── */
.an-subtitle { font-size: 0.8rem; color: #a09e97; margin: 12px 0 20px; }

/* ── sections ── */
.an-section {
  margin-bottom: 40px;
}
.an-section-head {
  display: flex; align-items: center; gap: 8px;
}
.an-section-title {
  font-family: 'Lora', Georgia, serif;
  font-size: 1.05rem; font-weight: 600;
  margin: 0 0 16px;
}
.an-section-badge {
  font-family: 'DM Mono', monospace;
  font-size: 0.7rem; font-weight: 500;
  color: #a09e97; background: #f0efe9;
  padding: 1px 7px; border-radius: 10px;
  vertical-align: middle;
}
.an-ai-badge {
  font-size: 0.6rem; font-weight: 700;
  color: #fff; background: linear-gradient(135deg, #6366f1, #8b5cf6);
  padding: 2px 8px; border-radius: 10px;
  letter-spacing: 0.05em;
  margin-bottom: 14px;
}
.an-section-desc {
  font-size: 0.78rem; color: #a09e97;
  margin: -10px 0 14px;
}

/* ── 卡片 ── */
.an-cards {
  display: flex; gap: 14px; flex-wrap: wrap;
}
.an-card {
  flex: 1; min-width: 120px;
  background: #f7f6f3; border-radius: 12px;
  padding: 18px 20px;
}
.an-card-num {
  display: block;
  font-family: 'DM Mono', monospace;
  font-size: 1.8rem; font-weight: 600; color: #1a1a18;
}
.an-card-label {
  font-size: 0.72rem; color: #a09e97; margin-top: 2px;
}
.an-card.accent-learn .an-card-num { color: #f59e0b; }
.an-card.accent-learn { background: #fef9e7; }
.an-card.accent-review .an-card-num { color: #6366f1; }
.an-card.accent-review { background: #eef2ff; }
.an-card.accent-mastered .an-card-num { color: #10b981; }
.an-card.accent-mastered { background: #ecfdf5; }
.an-card.accent-rate .an-card-num { color: #06b6d4; }
.an-card.accent-rate { background: #ecfeff; }

/* ── 词性分布 ── */
.an-pos-chart {
  display: flex; flex-direction: column; gap: 8px;
}
.an-pos-bar-wrap {
  display: flex; align-items: center; gap: 10px;
}
.an-pos-bar-wrap.clickable { cursor: pointer; }
.an-pos-bar-wrap.clickable:hover .an-pos-label { color: #3d3591; }
.an-pos-bar-wrap.clickable:hover .an-pos-bar { opacity: 0.8; }
.an-pos-label {
  width: 50px; font-family: 'DM Mono', monospace;
  font-size: 0.75rem; color: #6b6963; text-align: right; flex-shrink: 0;
}
.an-pos-track {
  flex: 1; height: 8px; background: #f0efe9; border-radius: 4px; overflow: hidden;
}
.an-pos-bar {
  height: 100%; border-radius: 4px;
  background: #6366f1;
  transition: width 0.5s ease;
}
.an-pos-count {
  font-family: 'DM Mono', monospace;
  font-size: 0.75rem; color: #a09e97; width: 32px; flex-shrink: 0;
}
.an-pos-total-bar {
  display: flex; height: 4px; border-radius: 2px; overflow: hidden;
  margin-top: 12px; gap: 1px;
}
.an-pos-total-seg {
  min-width: 1px; transition: all 0.5s ease;
}

/* ── 重复标记 ── */
.an-dup-grid {
  display: flex; flex-wrap: wrap; gap: 8px;
}
.an-dup-item {
  display: flex; align-items: center; gap: 6px;
  background: #fef9e7; border: 0.5px solid rgba(245,158,11,0.15);
  padding: 6px 12px; border-radius: 8px;
  cursor: pointer; transition: all 0.12s;
}
.an-dup-item:hover { background: #fef3c7; }
.an-dup-word {
  font-family: 'Lora', Georgia, serif;
  font-size: 0.88rem; color: #1a1a18;
}
.an-dup-count {
  font-family: 'DM Mono', monospace;
  font-size: 0.72rem; font-weight: 600;
  color: #f59e0b;
}
.an-dup-src {
  font-size: 0.65rem; color: #a09e97;
}

/* ── 困难词表格 ── */
.an-diff-table {
  border-radius: 10px; overflow: hidden;
  border: 0.5px solid rgba(0,0,0,0.06);
}
.an-diff-row {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 14px;
  font-size: 0.82rem;
  border-bottom: 0.5px solid rgba(0,0,0,0.04);
  cursor: pointer; transition: background 0.1s;
}
.an-diff-row:last-child { border-bottom: none; }
.an-diff-row:hover { background: #f7f6f3; }
.an-diff-head {
  font-size: 0.7rem; color: #a09e97; text-transform: uppercase;
  letter-spacing: 0.03em; cursor: default;
}
.an-diff-head:hover { background: transparent; }
.an-diff-word {
  flex: 0 0 140px; font-family: 'Lora', Georgia, serif;
  font-weight: 500;
}
.an-diff-meaning {
  flex: 1; color: #6b6963; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.an-diff-rate {
  flex: 0 0 110px; font-family: 'DM Mono', monospace;
  font-size: 0.75rem; color: #10b981; text-align: right;
}
.an-diff-rate.low { color: #ef4444; }
.an-diff-phase {
  flex: 0 0 60px; text-align: right;
}
.phase-badge {
  font-size: 0.65rem; padding: 2px 8px; border-radius: 8px;
  display: inline-block;
}
.phase-learn { background: #fef9e7; color: #b45309; }
.phase-review { background: #eef2ff; color: #4338ca; }
.phase-mastered { background: #ecfdf5; color: #047857; }

/* ── 来源 ── */
.an-source-list {
  display: flex; flex-wrap: wrap; gap: 8px;
}
.an-source-item {
  display: flex; align-items: center; gap: 8px;
  background: #f7f6f3; padding: 8px 14px; border-radius: 8px;
  cursor: pointer; transition: background 0.12s;
  font-size: 0.82rem;
}
.an-source-item:hover { background: #edeafd; }
.an-source-title { color: #1a1a18; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-source-count {
  font-family: 'DM Mono', monospace;
  font-size: 0.7rem; color: #a09e97;
}

/* ── AI 聚类 ── */
.an-cluster-empty {
  background: #f7f6f3; border-radius: 12px;
  padding: 28px; text-align: center;
  color: #a09e97; font-size: 0.85rem;
}
.an-cluster-empty p { margin: 0 0 16px; }
.an-cluster-btn {
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.82rem; font-weight: 500;
  color: #fff; background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border: none; padding: 10px 24px; border-radius: 8px;
  cursor: pointer; transition: opacity 0.15s; display: inline-flex; align-items: center; gap: 8px;
}
.an-cluster-btn:hover:not(:disabled) { opacity: 0.9; }
.an-cluster-btn:disabled { opacity: 0.6; cursor: default; }

.an-cluster-summary {
  font-size: 0.88rem; color: #6b6963; line-height: 1.6;
  background: #f7f6f3; padding: 16px; border-radius: 10px;
}
.an-cluster-groups {
  display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px;
}
.an-cluster-group {
  display: flex; flex-direction: column; gap: 4px;
  background: #f7f6f3; padding: 12px 16px; border-radius: 10px;
  cursor: pointer; transition: background 0.12s; min-width: 160px;
}
.an-cluster-group:hover { background: #edeafd; }
.an-cluster-label {
  font-weight: 600; font-size: 0.85rem;
}
.an-cluster-words {
  font-size: 0.7rem; color: #a09e97;
  line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.an-cluster-count {
  font-family: 'DM Mono', monospace;
  font-size: 0.65rem; color: #6b6963;
}
.an-cluster-themes { margin-top: 20px; }
.an-cluster-themes h3 {
  font-family: 'Lora', Georgia, serif;
  font-size: 0.9rem; font-weight: 600; margin: 0 0 12px;
}
.an-theme-list { display: flex; gap: 12px; flex-wrap: wrap; }
.an-theme-card {
  flex: 1; min-width: 200px;
  background: #eef2ff; padding: 14px; border-radius: 10px;
}
.an-theme-type {
  font-size: 0.6rem; font-weight: 700; text-transform: uppercase;
  color: #6366f1; letter-spacing: 0.04em;
  display: block; margin-bottom: 4px;
}
.an-theme-card strong {
  font-family: 'Lora', Georgia, serif;
  font-size: 0.92rem;
}
.an-theme-card p {
  font-size: 0.75rem; color: #6b6963; margin: 6px 0 0;
  line-height: 1.45;
}

/* ── 加载 ── */
.an-loading {
  text-align: center; padding: 60px 20px;
  font-size: 0.9rem; color: #a09e97;
}
.an-loading.an-error { color: #ef4444; }

/* ── 清理重复按钮 ── */
.an-dedup-btn {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.72rem; font-weight: 500;
  color: #ef4444; background: #fef2f2;
  border: 1px solid rgba(239,68,68,0.2);
  padding: 5px 12px; border-radius: 7px;
  cursor: pointer; margin-bottom: 14px; margin-left: 12px;
  transition: all 0.15s;
}
.an-dedup-btn:hover:not(:disabled) { background: #fee2e2; }
.an-dedup-btn:disabled { opacity: 0.6; cursor: default; }

/* ── 词性补全按钮 ── */
.an-enrich-btn {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.72rem; font-weight: 500;
  color: #6366f1; background: #eef2ff;
  border: 1px solid rgba(99,102,241,0.2);
  padding: 5px 12px; border-radius: 7px;
  cursor: pointer; margin-bottom: 14px; margin-left: 12px;
  transition: all 0.15s;
}
.an-enrich-btn:hover:not(:disabled) { background: #e0e7ff; }
.an-enrich-btn:disabled { opacity: 0.6; cursor: default; }

.an-spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
