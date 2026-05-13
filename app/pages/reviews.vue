<template>
  <div class="reviews-page">
    <div class="rv-header">
      <button class="sb-back" @click="navigateTo('/')">← 书架</button>
      <h1 class="rv-title">复习本</h1>

      <!-- 类型下拉 -->
      <select v-model="activeTab" class="rv-select">
        <option value="all">全部 ({{ counts.all }})</option>
        <option value="word">生词 ({{ counts.word }})</option>
        <option value="phrase">短语 ({{ counts.phrase }})</option>
        <option value="sentence">好句 ({{ counts.sentence }})</option>
      </select>

      <!-- 按书筛选 -->
      <select v-model="bookFilter" class="rv-select">
        <option value="all">全部书籍</option>
        <option v-for="b in books" :key="b.id" :value="b.id">{{ b.title }}</option>
      </select>
      <button class="theme-toggle" style="margin-left:auto" @click="theme.toggle()">{{ theme.dark.value ? '☀' : '🌙' }}</button>
    </div>

    <div class="rv-body">
      <div v-if="filtered.length === 0" class="lib-empty"><p>暂无标记</p></div>
      <div v-else class="rv-grid">
        <div v-for="item in filtered" :key="item.mark.id" class="rv-card" :class="{ expanded: expandedId === item.mark.id }">
          <div class="rv-card-main" :style="{ borderLeftColor: item.mark.color }" @click="toggleCard(item)">
            <div class="rv-card-top">
              <span class="rv-word" :class="{ sentence: item.mark.type === 'sentence' }">{{ item.mark.text }}</span>
              <span class="rv-actions">
                <button v-if="item.mark.type === 'word'" class="rv-play" :class="{ playing: playingId === item.mark.id }" @click.stop="playWord(item)"><span v-if="playingId === item.mark.id" class="mini-bars"><span></span><span></span><span></span></span><svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></button>
                <span class="rv-badge" :style="{ background: item.mark.color }">{{ typeMap[item.mark.type] }}</span>
              </span>
            </div>
            <div class="rv-card-mid">
              <span v-if="item.mark.type === 'word' && item.phonetic" class="rv-phonetic">{{ item.phonetic }}</span>
              <span v-if="item.brief" class="rv-brief">{{ item.brief }}</span>
            </div>
          </div>
          <div v-if="expandedId === item.mark.id" class="rv-card-detail" @click="openSource(item)">
            <p>{{ plainExcerpt(item.mark.detail) }}</p>
            <span class="rv-jump">点击跳转到原文位置 →</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Mark } from '#shared/types'
import { useTheme } from '~/composables/useTheme'
useHead({ title: '复习本' })
const theme = useTheme()

interface MarkItem { mark: Mark; title: string; textId: string; phonetic: string; brief: string }
interface Book { id: string; title: string }

const activeTab = ref('all')
const bookFilter = ref('all')
const items = ref<MarkItem[]>([])
const books = ref<Book[]>([])
const expandedId = ref('')
const playingId = ref('')

const typeMap: Record<string, string> = { word: '词', phrase: '短语', sentence: '句子' }

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
  return detail.replace(/\[PHONETIC\].*?\[\/PHONETIC\]/g, '').replace(/[#*|`]/g, '').replace(/\n+/g, ' ').trim().slice(0, 150)
}

function toggleCard(item: MarkItem) { expandedId.value = expandedId.value === item.mark.id ? '' : item.mark.id }
function playWord(item: MarkItem) {
  if (playingId.value === item.mark.id) return; playingId.value = item.mark.id
  const audio = new Audio(`https://audio.beingfine.cn/speeches/UK/UK-speech/${item.mark.text.replace(/[^a-zA-Z]/g, '').toLowerCase()}.mp3`)
  audio.play().catch(() => { const u = new SpeechSynthesisUtterance(item.mark.text); u.lang = 'en-GB'; speechSynthesis.speak(u) })
  setTimeout(() => { playingId.value = '' }, 2500)
}
function openSource(item: MarkItem) { navigateTo(`/read/${item.textId}?mark=${item.mark.paragraphId}`) }

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
            const phonetic = m.detail ? (m.detail.match(/\[PHONETIC\]\s*(\/[^/]+\/)\s*\[\/PHONETIC\]/) || [])[1] || '' : ''
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
.reviews-page { display: flex; flex-direction: column; height: 100vh; background: #fafbfc; }
.rv-header { padding: 12px 24px; border-bottom: 1px solid #e8ecf1; background: #ffffff; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.rv-title { font-size: 1.1em; font-weight: 600; color: #1e293b; margin-right: 8px; }
.rv-select { padding: 6px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; background: #ffffff; color: #475569; outline: none; cursor: pointer; }
.rv-select:focus { border-color: #6366f1; }

.rv-body { flex: 1; overflow-y: auto; padding: 24px; }
.rv-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; max-width: 900px; }

.rv-card { background: #ffffff; border: 1px solid #e8ecf1; border-radius: 10px; overflow: hidden; transition: box-shadow 0.15s; }
.rv-card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
.rv-card-main { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border-left: 3px solid; cursor: pointer; }
.rv-card-top { display: flex; align-items: center; gap: 8px; }
.rv-word { font-weight: 600; font-size: 1.05em; color: #1e293b; flex: 0 0 auto; }
.rv-word.sentence { flex: 1; overflow: hidden; white-space: nowrap; position: relative; }
.rv-word.sentence::after { content: ''; position: absolute; right: 0; top: 0; bottom: 0; width: 40px; background: linear-gradient(to right, transparent, #ffffff); pointer-events: none; }
.rv-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; flex-shrink: 0; }
.rv-card-mid { display: flex; align-items: center; gap: 8px; }
.rv-phonetic { font-family: Georgia, serif; font-size: 0.85em; color: #6366f1; white-space: nowrap; }
.rv-brief { font-size: 12px; color: #64748b; line-height: 1.4; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rv-play { width: 28px; height: 28px; border: 2px solid #6366f1; border-radius: 50%; background: transparent; color: #6366f1; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.15s; }
.rv-play:hover { background: #eef2ff; }
.rv-play.playing { background: #eef2ff; border-color: #818cf8; }
.mini-bars { display: flex; align-items: flex-end; gap: 2px; height: 12px; }
.mini-bars span { width: 2px; background: #6366f1; border-radius: 1px; animation: barAnim 0.7s infinite alternate; }
.mini-bars span:nth-child(1) { height: 6px; animation-delay: 0s; }
.mini-bars span:nth-child(2) { height: 12px; animation-delay: 0.12s; }
.mini-bars span:nth-child(3) { height: 8px; animation-delay: 0.24s; }
@keyframes barAnim { from { transform: scaleY(0.4); opacity: 0.4; } to { transform: scaleY(1); opacity: 1; } }
.rv-badge { font-size: 10px; font-weight: 600; color: #ffffff; padding: 2px 8px; border-radius: 4px; white-space: nowrap; }
.rv-card-detail { padding: 0 16px 14px; border-top: 1px solid #f1f5f9; cursor: pointer; }
.rv-card-detail p { font-size: 12px; color: #64748b; line-height: 1.6; margin: 12px 0 8px; }
.rv-jump { font-size: 11px; color: #6366f1; }
</style>
