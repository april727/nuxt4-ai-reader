<template>
  <div class="reviews-page">
    <!-- 顶部导航 -->
    <header class="rv-header">
      <button class="rv-back" @click="navigateTo('/')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        书架
      </button>

      <h1 class="rv-title">复习本</h1>
      <p class="rv-subtitle" v-if="filtered.length">
        {{ activeTab === 'all' ? `共 ${filtered.length} 项` : `${typeMap[activeTab]} · ${filtered.length} 项` }}
      </p>

      <div class="rv-filters">
        <div class="rv-filter-group">
          <FilterChip v-model="activeTab" :options="filterTabs" />
        </div>

        <select v-model="bookFilter" class="rv-book-select">
          <option value="all">全部书籍 ({{ booksWithMarks.length }})</option>
          <option v-for="b in booksWithMarks" :key="b.id" :value="b.id">{{ b.title }}</option>
        </select>

        <button v-if="items.length" class="rv-export-btn" @click="showExport = true" title="导出标记">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          导出
        </button>
      </div>
    </header>

    <!-- 卡片区 -->
    <div class="rv-body">
      <!-- 空态 -->
      <div v-if="filtered.length === 0" class="rv-empty">
        <div class="rv-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1a2 2 0 0 0 2 2v1.93z"/>
          </svg>
        </div>
        <p class="rv-empty-title">还没有任何标记</p>
        <p class="rv-empty-hint">在阅读时选中文字，点击「词」「短」「句」即可添加</p>
      </div>

      <!-- 卡片网格 -->
      <div v-else class="rv-grid" ref="gridRef">
        <article
          v-for="(item, i) in filtered"
          :key="item.mark.id"
          class="rv-card"
          :class="{ expanded: expandedId === item.mark.id }"
          :style="{ '--card-delay': i * 0.04 + 's' }"
          @click="toggleCard(item)"
        >
          <!-- 主行：单词 + 右侧动作 -->
          <div class="rv-card-row" :style="{ borderLeftColor: item.mark.color }">
            <div class="rv-card-content">
              <!-- 词语 / 短语 / 句子 -->
              <div class="rv-card-head">
                <span
                  class="rv-word"
                  :class="{
                    sentence: item.mark.type === 'sentence',
                    phrase: item.mark.type === 'phrase'
                  }"
                >{{ item.mark.text }}</span>

                <button
                  v-if="item.mark.type === 'word'"
                  class="rv-play-btn"
                  :class="{ playing: playingId === item.mark.id }"
                  @click.stop="playWord(item)"
                  :aria-label="'发音: ' + item.mark.text"
                >
                  <span v-if="playingId === item.mark.id" class="play-bars">
                    <span></span><span></span><span></span>
                  </span>
                  <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5,3 19,12 5,21"/>
                  </svg>
                </button>
              </div>

              <!-- 音标 + 释义预览 -->
              <div class="rv-card-meta">
                <span v-if="item.mark.type === 'word' && item.phonetic" class="rv-phonetic">{{ item.phonetic }}</span>
                <span class="rv-badge" :style="{ background: item.mark.color }">{{ typeMap[item.mark.type] }}</span>
                <span v-if="item.brief" class="rv-brief">{{ item.brief }}</span>
              </div>
            </div>
          </div>

          <!-- 展开详情 -->
          <Transition name="card-expand">
            <div v-if="expandedId === item.mark.id" class="rv-card-detail" @click.stop="openSource(item)">
              <p>{{ plainExcerpt(item.mark.detail) }}</p>
              <span class="rv-jump">
                跳转到原文
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                </svg>
              </span>
            </div>
          </Transition>
        </article>
      </div>
    </div>

    <!-- 导出标记弹窗 -->
    <Transition name="modal-fade">
      <div v-if="showExport" class="modal-overlay" @click.self="showExport = false">
        <div class="modal-card" style="max-width: 400px">
          <div class="modal-header">
            <h3 class="modal-title">导出标记</h3>
            <button class="modal-close" @click="showExport = false">&times;</button>
          </div>
          <div class="modal-body">
            <p class="export-summary">{{ filtered.length }} 个标记（{{ counts.word }} 生词 · {{ counts.phrase }} 短语 · {{ counts.sentence }} 好句）</p>
            <div class="export-options">
              <button class="export-option" @click="exportAs('csv')">
                <span class="export-option-label">Anki CSV</span>
                <span class="export-option-hint">导入 Anki 闪卡</span>
              </button>
              <button class="export-option" @click="exportAs('md')">
                <span class="export-option-label">Markdown</span>
                <span class="export-option-hint">纯文本笔记</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import type { Mark } from '#shared/types'

useHead({ title: '复习本' })

interface MarkItem { mark: Mark; title: string; textId: string; phonetic: string; brief: string }
interface Book { id: string; title: string }

const activeTab = ref('all')
const bookFilter = ref('all')
const items = ref<MarkItem[]>([])
const books = ref<Book[]>([])
const expandedId = ref('')
const playingId = ref('')
const gridRef = ref<HTMLElement | null>(null)

const filterTabs = [
  { key: 'all', label: '全部' },
  { key: 'word', label: '生词' },
  { key: 'phrase', label: '短语' },
  { key: 'sentence', label: '好句' },
]

const typeMap: Record<string, string> = { word: '生词', phrase: '短语', sentence: '好句' }

const counts = computed(() => {
  const c: Record<string, number> = { all: items.value.length, word: 0, phrase: 0, sentence: 0 }
  for (const it of items.value) c[it.mark.type]++
  return c
})

const filtered = computed(() => {
  let list = items.value
  if (activeTab.value !== 'all') list = list.filter(i => i.mark.type === activeTab.value)
  if (bookFilter.value !== 'all') list = list.filter(i => i.textId === bookFilter.value)
  return list
})

function extractBrief(detail: string): string {
  if (!detail) return ''
  const clean = detail.replace(/\[PHONETIC\].*?\[\/PHONETIC\]/g, '').replace(/[#*|`]/g, '')
  const m = clean.match(/基本释义[^\n]*\n(.+)/)
  if (!m) return clean.split('\n').filter((s: string) => s.trim().length > 5)[0]?.trim().slice(0, 60) || ''
  return m[1].replace(/^\d+[\.\、\)]\s*/, '').trim().slice(0, 60)
}

function plainExcerpt(detail: string): string {
  if (!detail) return ''
  return detail.replace(/\[PHONETIC\].*?\[\/PHONETIC\]/g, '').replace(/[#*|`]/g, '').replace(/\n+/g, ' ').trim().slice(0, 180)
}

function toggleCard(item: MarkItem) {
  expandedId.value = expandedId.value === item.mark.id ? '' : item.mark.id
}

function playWord(item: MarkItem) {
  if (playingId.value === item.mark.id) return
  playingId.value = item.mark.id
  const audio = new Audio(
    `https://audio.beingfine.cn/speeches/UK/UK-speech/${item.mark.text.replace(/[^a-zA-Z]/g, '').toLowerCase()}.mp3`
  )
  audio.play().catch(() => {
    const u = new SpeechSynthesisUtterance(item.mark.text)
    u.lang = 'en-GB'
    speechSynthesis.speak(u)
  })
  setTimeout(() => { playingId.value = '' }, 2500)
}

function openSource(item: MarkItem) {
  navigateTo(`/read/${item.textId}?mark=${item.mark.paragraphId}`)
}

// 只显示有标记的书籍
const booksWithMarks = computed(() => {
  const ids = new Set(items.value.map(i => i.textId))
  return books.value.filter(b => ids.has(b.id))
})

// ── 导出 ──
const showExport = ref(false)

function exportAs(format: 'csv' | 'md') {
  const list = filtered.value.map(i => ({
    text: i.mark.text,
    type: i.mark.type,
    detail: i.mark.detail || '',
    note: i.mark.note || '',
  }))

  let content = ''
  let filename = ''

  if (format === 'csv') {
    const rows = list.map(m => {
      const back = [m.detail, m.note].filter(Boolean).join('; ')
      return `"${m.text}","${back}","ai-reader ${m.type}"`
    })
    content = 'front,back,tags\n' + rows.join('\n')
    filename = 'anki-cards.csv'
  } else {
    const groups: Record<string, typeof list> = { word: [], phrase: [], sentence: [] }
    for (const m of list) groups[m.type].push(m)
    const lines: string[] = [`# 标记导出`, '']
    for (const [type, label] of [['word', '生词'], ['phrase', '短语'], ['sentence', '好句']] as const) {
      if (groups[type].length) {
        lines.push(`## ${label}`, '')
        for (const m of groups[type]) {
          const extra = [m.detail, m.note].filter(Boolean).join(' — ')
          lines.push(`- **${m.text}**${extra ? ` · ${extra}` : ''}`)
        }
        lines.push('')
      }
    }
    content = lines.join('\n')
    filename = 'marks-export.md'
  }

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
  showExport.value = false
}

onMounted(async () => {
  try {
    const entries = await $fetch<any[]>('/api/text/list?folder=all')
    const all: MarkItem[] = []
    for (const e of entries) {
      books.value.push({ id: e.id, title: e.title || e.id })
      if (!e.id) continue
      try {
        const full = await $fetch<any>(`/api/text/${e.id}`)
        if (full.marks) {
          for (const m of full.marks) {
            const phonetic = m.detail
              ? (m.detail.match(/\[PHONETIC\]\s*(\/[^/]+\/)\s*\[\/PHONETIC\]/) || [])[1] || ''
              : ''
            all.push({ mark: m, title: full.title || e.title, textId: e.id, phonetic, brief: extractBrief(m.detail) })
          }
        }
      } catch {}
    }
    items.value = all.sort((a, b) => (b.mark.createdAt || '').localeCompare(a.mark.createdAt || ''))
  } catch {}
})
</script>

<style scoped>
.reviews-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f7f6f3;
  color: #1a1a18;
}

/* ── 顶部导航 ── */
.rv-header {
  flex-shrink: 0;
  padding: 28px 36px 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 24px;
  /* bottom border handled by filters row */
}

.rv-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  font-weight: 450;
  color: #8a877c;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 0;
  transition: color 0.2s;
  font-family: inherit;
}
.rv-back:hover {
  color: #3d3591;
}

.rv-title {
  font-family: 'Lora', Georgia, serif;
  font-size: 1.65em;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: #1a1a18;
  margin: 0;
}

.rv-subtitle {
  font-size: 13px;
  color: #a09e97;
  font-weight: 400;
  margin: 0;
}

/* ── 筛选栏 ── */
.rv-filters {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.rv-filter-group {
  display: flex;
  gap: 4px;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 10px;
  padding: 3px;
}

.rv-book-select {
  margin-left: auto;
  padding: 6px 12px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  font-size: 13px;
  background: #ffffff;
  color: #6b6963;
  outline: none;
  cursor: pointer;
  font-family: inherit;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238a877c'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 28px;
}
.rv-book-select:focus {
  border-color: #3d3591;
}

/* ── 主体区域 ── */
.rv-body {
  flex: 1;
  overflow-y: auto;
  padding: 32px 36px;
}

.rv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 14px;
  max-width: 1000px;
}

/* ── 卡片 ── */
.rv-card {
  background: #ffffff;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.05);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
  animation: cardIn 0.4s ease-out both;
  animation-delay: var(--card-delay);
}
@keyframes cardIn {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.rv-card:hover {
  border-color: rgba(0, 0, 0, 0.1);
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.05);
}
.rv-card.expanded {
  border-color: rgba(61, 53, 145, 0.12);
  box-shadow: 0 2px 20px rgba(61, 53, 145, 0.06);
}

.rv-card-row {
  display: flex;
  padding: 16px 20px;
  border-left: 3px solid;
  gap: 14px;
  align-items: flex-start;
}

.rv-card-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rv-card-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* ── 词语显示 ── */
.rv-word {
  font-family: 'DM Sans', sans-serif;
  font-size: 1.15em;
  font-weight: 600;
  color: #1a1a18;
  letter-spacing: -0.005em;
}
.rv-word.phrase {
  font-size: 1.05em;
  font-weight: 550;
}
.rv-word.sentence {
  font-family: 'Lora', Georgia, serif;
  font-size: 0.95em;
  font-weight: 400;
  font-style: italic;
  line-height: 1.55;
  color: #3d3535;
  flex: 1;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* ── 发音按钮 ── */
.rv-play-btn {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border: 1.5px solid #e2dff0;
  border-radius: 50%;
  background: transparent;
  color: #3d3591;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.rv-play-btn:hover {
  background: #f3f0fd;
  border-color: #3d3591;
}
.rv-play-btn.playing {
  background: #3d3591;
  border-color: #3d3591;
}
.rv-play-btn.playing svg {
  display: none;
}

.play-bars {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 13px;
}
.play-bars span {
  width: 2.5px;
  background: #ffffff;
  border-radius: 1px;
  animation: barAnim 0.65s infinite alternate ease-in-out;
}
.play-bars span:nth-child(1) { height: 7px; }
.play-bars span:nth-child(2) { height: 13px; animation-delay: 0.1s; }
.play-bars span:nth-child(3) { height: 9px; animation-delay: 0.2s; }
@keyframes barAnim {
  from { transform: scaleY(0.35); opacity: 0.5; }
  to { transform: scaleY(1); opacity: 1; }
}

/* ── 元信息行 ── */
.rv-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.rv-phonetic {
  font-family: 'DM Mono', monospace;
  font-size: 12.5px;
  color: #7c77a6;
  white-space: nowrap;
}

.rv-badge {
  font-size: 10px;
  font-weight: 600;
  color: #ffffff;
  padding: 1.5px 7px;
  border-radius: 4px;
  white-space: nowrap;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.rv-brief {
  font-size: 12.5px;
  color: #8a877c;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

/* ── 展开详情 ── */
.rv-card-detail {
  padding: 0 20px 18px;
  cursor: pointer;
  border-top: 1px solid rgba(0, 0, 0, 0.04);
}
.rv-card-detail p {
  font-size: 13px;
  color: #6b6963;
  line-height: 1.7;
  margin: 14px 0 10px;
}
.rv-jump {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: #3d3591;
  font-weight: 500;
  transition: gap 0.2s;
}
.rv-card-detail:hover .rv-jump {
  gap: 8px;
}

/* 展开动画 */
.card-expand-enter-active {
  transition: all 0.25s ease-out;
  overflow: hidden;
}
.card-expand-leave-active {
  transition: all 0.18s ease-in;
  overflow: hidden;
}
.card-expand-enter-from,
.card-expand-leave-to {
  opacity: 0;
  max-height: 0;
}
.card-expand-enter-to,
.card-expand-leave-from {
  opacity: 1;
  max-height: 240px;
}

/* ── 空态 ── */
.rv-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 24px;
  text-align: center;
}
.rv-empty-icon {
  color: #d4d1c8;
  margin-bottom: 20px;
}
.rv-empty-title {
  font-family: 'Lora', Georgia, serif;
  font-size: 1.1em;
  color: #a09e97;
  margin: 0 0 6px;
}
.rv-empty-hint {
  font-size: 13px;
  color: #c4c1ba;
  margin: 0;
}
/* ── 通用弹窗 ── */
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.2s; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.modal-overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0,0,0,0.2); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
}
.modal-card {
  background: #ffffff; border-radius: 16px;
  box-shadow: 0 16px 48px rgba(0,0,0,0.1);
  width: 90vw; overflow: hidden;
}
.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 24px; border-bottom: 1px solid rgba(0,0,0,0.05);
}
.modal-title { font-family: 'Lora', Georgia, serif; font-size: 16px; font-weight: 500; color: #1a1a18; }
.modal-close {
  width: 28px; height: 28px; border: none; border-radius: 50%;
  background: transparent; color: #a09e97; font-size: 18px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.modal-close:hover { background: rgba(0,0,0,0.05); }
.modal-body { padding: 24px; }

/* ── 导出按钮 ── */
.rv-export-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 14px;
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 10px;
  background: #ffffff;
  color: #6b6963;
  font-size: 13px;
  font-family: 'DM Sans', sans-serif;
  cursor: pointer;
  transition: all 0.15s;
  margin-left: auto;
}
.rv-export-btn:hover {
  color: #3d3591;
  border-color: rgba(61,53,145,0.2);
  background: #f8f7ff;
}

/* ── 导出弹窗 ── */
.export-summary {
  font-size: 13px;
  color: #6b6963;
  margin: 0 0 20px;
  text-align: center;
}
.export-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.export-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 14px 16px;
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 10px;
  background: #ffffff;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
}
.export-option:hover {
  border-color: rgba(61,53,145,0.2);
  background: #f8f7ff;
}
.export-option-label {
  font-size: 14px;
  font-weight: 500;
  color: #1a1a18;
}
.export-option-hint {
  font-size: 12px;
  color: #a09e97;
}

</style>
