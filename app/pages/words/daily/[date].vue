<template>
  <div class="dd-page">
    <PageHeader :title="`${formatDate(date)} ${dayOfWeek(date)}`" active="daily" back-to="/words/daily" back-label="每日">
      <template #actions>
        <button v-if="detail && detail.wordCount" class="dd-hdr-btn" @click="goCards">闪卡学习</button>
        <button v-if="detail && detail.words.length" class="dd-hdr-btn" @click="exportTxt">导出 TXT</button>
      </template>
    </PageHeader>

    <div class="dd-body">
      <div v-if="loading" class="dd-loading">加载中…</div>
      <div v-else-if="!detail" class="dd-empty">当天无学习记录</div>

      <template v-else>
      <!-- 统计卡片 -->
      <div class="dd-cards">
        <div class="dd-card">
          <span class="dd-card-num">{{ detail.wordCount }}</span>
          <span class="dd-card-label">生词</span>
        </div>
        <div class="dd-card">
          <span class="dd-card-num">{{ detail.phraseCount }}</span>
          <span class="dd-card-label">短语</span>
        </div>
        <div class="dd-card">
          <span class="dd-card-num">{{ detail.sentenceCount }}</span>
          <span class="dd-card-label">好句</span>
        </div>
      </div>

      <!-- 词性分布 -->
      <div v-if="Object.keys(detail.posCounts).length" class="dd-section">
        <h3>词性分布</h3>
        <div class="dd-pos-row">
          <span v-for="(count, pos) in detail.posCounts" :key="pos" class="dd-pos-chip">{{ pos }} {{ count }}</span>
        </div>
      </div>

      <!-- 词汇列表 -->
      <div v-if="detail.words.length" class="dd-section">
        <h3>今日词汇 ({{ detail.words.length }})</h3>
        <div class="dd-word-chips">
          <span v-for="w in detail.words" :key="w" class="dd-word-chip">{{ w }}</span>
        </div>
      </div>

      <!-- 标记记录 -->
      <div v-if="detail.marks.length" class="dd-section">
        <h3>标记记录</h3>
        <div class="dd-mark-list">
          <div v-for="m in detail.marks" :key="m.id" class="dd-mark-item">
            <span class="dd-mark-type" :class="'mt-' + m.type">{{ typeLabel(m.type) }}</span>
            <span class="dd-mark-word">{{ m.text }}</span>
            <span v-if="m.phonetic" class="dd-mark-ph">{{ m.phonetic }}</span>
            <span v-if="m.pos" class="dd-mark-pos">{{ m.pos }}</span>
            <span class="dd-mark-brief" v-if="m.brief">{{ m.brief }}</span>
            <span class="dd-mark-src">{{ m.textTitle }}</span>
          </div>
        </div>
      </div>

      <!-- AI 解读 -->
      <div class="dd-section dd-insight">
        <h3>AI 解读</h3>
        <div v-if="!insightContent && !insightLoading" class="dd-insight-empty">
          <button class="dd-insight-btn" @click="loadInsight(date)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l1.5 6.5L20 10l-6.5 1.5L12 18l-1.5-6.5L4 10l6.5-1.5z"/></svg>
            生成 AI 解读
          </button>
        </div>
        <div v-else-if="insightLoading" class="dd-insight-loading">AI 分析中…</div>
        <div v-else class="dd-insight-content">
          <div class="dd-insight-head">
            <span class="dd-insight-badge">AI</span>
            <button class="dd-insight-refresh" @click="loadInsightForce(date)" title="重新生成">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            </button>
          </div>
          <MarkdownRenderer :content="insightContent" />
        </div>
      </div>
    </template>
    </div>
  </div>
</template>

<script setup lang="ts">
interface DayDetail {
  date: string; total: number; wordCount: number; phraseCount: number; sentenceCount: number
  posCounts: Record<string, number>; words: string[]
  marks: Array<{ id: string; text: string; type: string; pos: string; phonetic: string; brief: string; textTitle: string }>
}

const route = useRoute()
const date = route.params.date as string

const loading = ref(true)
const detail = ref<DayDetail | null>(null)
const insightContent = ref('')
const insightLoading = ref(false)

function formatDate(d: string): string {
  const parts = d.split('-')
  return `${parseInt(parts[1])}月${parseInt(parts[2])}日`
}
function dayOfWeek(d: string): string {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(d).getDay()]
}
function typeLabel(t: string): string {
  const m: Record<string, string> = { word: '词', phrase: '短', sentence: '句' }
  return m[t] || t
}

async function loadInsight(d: string, force = false) {
  insightLoading.value = true
  insightContent.value = ''
  try {
    const result = await $fetch<{ content: string }>('/api/words/daily-insight', {
      method: 'POST',
      body: { date: d, force },
    })
    insightContent.value = result.content
  } catch {
    insightContent.value = 'AI 分析失败，请稍后重试'
  }
  insightLoading.value = false
}
function loadInsightForce(d: string) { loadInsight(d, true) }

function goCards() {
  navigateTo(`/wordbooks/wb_default/cards?dailyDate=${date}&dailyType=word`)
}

function exportTxt() {
  if (!detail.value) return
  const text = detail.value.words.join('\n')
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `words-${date}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(async () => {
  try {
    detail.value = await $fetch<DayDetail>(`/api/words/daily-detail?date=${date}`)
    if (detail.value) {
      // 尝试加载已缓存的 AI 解读
      try {
        const result = await $fetch<{ content: string }>('/api/words/daily-insight', {
          method: 'POST', body: { date },
        })
        insightContent.value = result.content
      } catch {}
    }
  } catch {}
  loading.value = false
})

definePageMeta({ layout: false })
</script>

<style scoped>
.dd-page {
  display: flex; flex-direction: column;
  height: 100vh; background: #f7f6f3;
  font-family: 'DM Sans', system-ui, sans-serif; color: #1a1a18;
}
.dd-body {
  flex: 1; overflow-y: auto;
  padding: 0 36px 60px;
  max-width: 800px; width: 100%; margin: 0 auto;
}

/* ── 统计卡片 ── */
.dd-cards { display: flex; gap: 12px; margin-bottom: 24px; }
.dd-card {
  flex: 1; text-align: center;
  background: #f7f6f3; border-radius: 12px; padding: 18px 12px;
}
.dd-card-num {
  display: block; font-family: 'DM Mono', monospace;
  font-size: 1.8rem; font-weight: 600; color: #1a1a18;
}
.dd-card-label { font-size: 0.72rem; color: #a09e97; margin-top: 2px; }

/* ── 区块 ── */
.dd-section { margin-bottom: 24px; }
.dd-section h3 {
  font-family: 'Lora', Georgia, serif;
  font-size: 0.95rem; font-weight: 600; margin: 0 0 10px;
}

/* ── 词性 ── */
.dd-pos-row { display: flex; flex-wrap: wrap; gap: 4px; }
.dd-pos-chip {
  font-family: 'DM Mono', monospace;
  font-size: 0.7rem; padding: 2px 8px;
  background: #eef2ff; color: #4338ca; border-radius: 4px;
}

/* ── 词汇 ── */
.dd-word-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.dd-word-chip {
  font-size: 0.8rem; padding: 3px 10px;
  background: #fff; border: 0.5px solid rgba(0,0,0,0.08);
  border-radius: 6px; color: #1a1a18;
}

/* ── 标记 ── */
.dd-mark-list { display: flex; flex-direction: column; gap: 4px; }
.dd-mark-item {
  display: flex; align-items: center; gap: 8px;
  font-size: 0.78rem; padding: 8px 12px;
  background: #f7f6f3; border-radius: 8px;
}
.dd-mark-type {
  font-size: 0.58rem; font-weight: 700; padding: 1px 5px;
  border-radius: 3px; color: #fff; flex-shrink: 0;
}
.mt-word { background: #f59e0b; }
.mt-phrase { background: #10b981; }
.mt-sentence { background: #06b6d4; }
.dd-mark-word { font-family: 'Lora', Georgia, serif; font-weight: 500; }
.dd-mark-ph { font-size: 0.7rem; color: #a09e97; font-family: 'DM Mono', monospace; }
.dd-mark-pos { font-family: 'DM Mono', monospace; font-size: 0.65rem; color: #6366f1; }
.dd-mark-brief { flex: 1; font-size: 0.72rem; color: #8a877c; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dd-mark-src { font-size: 0.65rem; color: #c4c1ba; flex-shrink: 0; }

/* ── AI 解读 ── */
.dd-insight { border-top: 1px solid rgba(0,0,0,0.06); padding-top: 20px; }
.dd-insight-empty { text-align: center; padding: 16px 0; }
.dd-insight-btn {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 0.82rem; font-weight: 500;
  color: #fff; background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer;
}
.dd-insight-btn:hover { opacity: 0.9; }
.dd-insight-loading { color: #a09e97; padding: 16px 0; }
.dd-insight-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.dd-insight-badge {
  font-size: 0.6rem; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  padding: 2px 8px; border-radius: 8px;
}
.dd-insight-refresh {
  border: none; background: none; color: #a09e97; cursor: pointer;
  padding: 3px 6px; border-radius: 4px;
}
.dd-insight-refresh:hover { background: #f0efe9; color: #3d3591; }
.dd-insight-content {
  font-size: 0.85rem; line-height: 1.7; color: #3d392d;
}
.dd-insight-content :deep(h3) { font-size: 0.9rem; margin: 12px 0 6px; }
.dd-insight-content :deep(p) { margin: 4px 0; }

.dd-empty, .dd-loading { text-align: center; padding: 60px 20px; color: #a09e97; }

.dd-hdr-btn {
  padding: 4px 10px; border: 1px solid #e0ddd5; border-radius: 6px;
  background: #fff; font-size: 13px; cursor: pointer;
  font-family: 'DM Sans', sans-serif; color: #666; white-space: nowrap;
}
.dd-hdr-btn:hover { border-color: #3d3591; color: #3d3591; }
</style>
