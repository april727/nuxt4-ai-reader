<template>
  <div class="fc-app">
    <!-- header -->
    <header class="fc-header">
      <NuxtLink :to="backUrl" class="fc-back-btn" aria-label="返回">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="15 18 9 12 15 6"/></svg>
      </NuxtLink>
      <div class="fc-brand">
        <div class="fc-mark">卡</div>
        <div class="fc-title">闪忆卡片<small>FLASHCARD ARCHIVE</small></div>
      </div>
      <div style="position:relative;">
        <button class="fc-settings-btn" @click="showSettings = !showSettings" aria-label="设置">⚙</button>
        <div v-if="showSettings" class="fc-settings-pop" @click.stop>
          <div class="fc-settings-row" @click="settings.autoSpeak = !settings.autoSpeak">
            <span>自动发音</span>
            <div class="fc-toggle" :class="{ on: settings.autoSpeak }" />
          </div>
          <div class="fc-settings-row" @click="settings.showZh = !settings.showZh">
            <span>显示例句翻译</span>
            <div class="fc-toggle" :class="{ on: settings.showZh }" />
          </div>
          <button class="fc-settings-close" @click="showSettings = false">关闭</button>
        </div>
      </div>
    </header>

    <!-- type tabs -->
    <div class="fc-tabs">
      <button
        v-for="t in typeOptions"
        :key="t.key"
        :data-type="t.key"
        :class="{ active: cardType === t.key }"
        @click="switchType(t.key)"
      >{{ t.label }}</button>
    </div>

    <!-- deck info -->
    <div class="fc-deck-info">
      <span class="fc-cat-label">{{ catLabel }}</span>
      <span class="fc-count" v-if="queue.length">{{ pad(currentIdx + 1) }} / {{ pad(queue.length) }}</span>
    </div>

    <!-- card stage -->
    <div class="fc-stage" v-if="queue.length && currentWord">
      <div class="fc-peek" />
      <div
        class="fc-flip-card"
        :class="{ flipped: flipped && !storyOpen }"
        tabindex="0" role="button"
        @click="onCardClick"
        @keydown.enter.space.prevent="onCardClick"
      >
        <div class="fc-flip-inner">
          <!-- front face -->
          <div class="fc-face fc-front" :style="{ '--accent': accentColor, '--accent-soft': accentSoft }">
            <div class="fc-stamp">{{ stampChar }}</div>
            <div class="fc-catalog">NO. {{ pad(currentWord.__index || currentIdx + 1) }}</div>
            <div class="fc-front-content">
              <div
                class="fc-headword"
                :class="{
                  'fc-headword--phrase': effectiveType === 'phrase',
                  'fc-headword--sentence': effectiveType === 'sentence',
                }"
              >{{ currentWord.word }}</div>
              <button
                v-if="effectiveType === 'word'"
                class="fc-speak-btn"
                :style="{ '--accent': accentColor }"
                :class="{ speaking: isSpeaking }"
                @click.stop="pronounceCurrent"
                aria-label="发音"
              >🔊</button>
              <div class="fc-tap-hint">点击卡片翻转 · 查看释义</div>
            </div>
          </div>

          <!-- back face -->
          <div class="fc-face fc-back" :style="{ '--accent': accentColor, '--accent-soft': accentSoft }">
            <div class="fc-stamp">{{ stampChar }}</div>
            <div class="fc-catalog">NO. {{ pad(currentWord.__index || currentIdx + 1) }}</div>
            <div class="fc-back-content">
              <!-- word type -->
              <template v-if="effectiveType === 'word'">
                <div class="fc-bc-head">
                  <span class="fc-bc-word">{{ currentWord.word }}</span>
                  <span class="fc-bc-ipa">{{ currentWord.phonetic }}</span>
                </div>
                <div class="fc-bc-meaning">{{ currentWord.meaning }}</div>
                <div v-if="currentWord.example" class="fc-bc-section">
                  <span class="fc-bc-label">例句</span>
                  <div class="fc-bc-example">
                    {{ currentWord.example }}
                    <span v-if="settings.showZh && enhData?.exampleZh" class="fc-bc-example-zh">{{ enhData.exampleZh }}</span>
                  </div>
                </div>
                <!-- AI enrichment loading -->
                <div v-if="enrichLoading" class="fc-enrich-loading">
                  <span class="fc-enrich-spinner" />
                  <span>AI 解析中…</span>
                </div>
                <!-- AI enrichment retry -->
                <button v-else-if="!enhData && enrichError" class="fc-enrich-btn" @click.stop="enrichCurrent">
                  🔄 重新解析
                </button>
                <!-- AI enrichment content -->
                <template v-else-if="enhData">
                  <div v-if="enhData.roots?.length" class="fc-bc-section">
                    <span class="fc-bc-label">词根拆解</span>
                    <div class="fc-root-parts">
                      <span v-for="r in enhData.roots" :key="r.part" class="fc-root-chip">
                        <b>{{ r.part }}</b> — {{ r.note }}
                      </span>
                    </div>
                    <div v-if="enhData.rootNote" class="fc-root-note">{{ enhData.rootNote }}</div>
                  </div>
                  <div v-if="enhData.related?.length" class="fc-bc-section">
                    <span class="fc-bc-label">同词根词汇</span>
                    <div class="fc-related-words">
                      <span v-for="w in enhData.related" :key="w" class="fc-related-word">{{ w }}</span>
                    </div>
                  </div>
                  <div v-if="enhData.similar?.length" class="fc-bc-section">
                    <span class="fc-bc-label">相近词</span>
                    <div class="fc-related-words">
                      <span v-for="w in enhData.similar" :key="w" class="fc-related-word">{{ w }}</span>
                    </div>
                  </div>
                  <button v-if="enhData.funFact" class="fc-story-tab" @click.stop="openStory">📖 查看趣味知识</button>
                </template>
              </template>

              <!-- phrase type -->
              <template v-else-if="effectiveType === 'phrase'">
                <div class="fc-bc-head"><span class="fc-bc-word">{{ currentWord.word }}</span></div>
                <div class="fc-bc-meaning">{{ currentWord.meaning }}</div>
                <div v-if="currentWord.example" class="fc-bc-section">
                  <span class="fc-bc-label">例句</span>
                  <div class="fc-bc-example">
                    {{ currentWord.example }}
                    <span v-if="settings.showZh && enhData?.exampleZh" class="fc-bc-example-zh">{{ enhData.exampleZh }}</span>
                  </div>
                </div>
                <!-- AI enrichment loading -->
                <div v-if="enrichLoading" class="fc-enrich-loading">
                  <span class="fc-enrich-spinner" />
                  <span>AI 解析中…</span>
                </div>
                <!-- AI enrichment retry -->
                <button v-else-if="!enhData && enrichError" class="fc-enrich-btn" @click.stop="enrichCurrent">
                  🔄 重新解析
                </button>
                <!-- AI enrichment content -->
                <template v-else-if="enhData">
                  <div v-if="enhData.similar?.length" class="fc-bc-section">
                    <span class="fc-bc-label">相近短语</span>
                    <div class="fc-related-words">
                      <span v-for="w in enhData.similar" :key="w" class="fc-related-word">{{ w }}</span>
                    </div>
                  </div>
                  <button v-if="enhData.funFact" class="fc-story-tab" @click.stop="openStory">📖 查看趣味知识</button>
                </template>
              </template>

              <!-- sentence type -->
              <template v-else-if="effectiveType === 'sentence'">
                <div class="fc-translation-block">
                  <span class="fc-trans-en">{{ currentWord.word }}</span>
                  <span class="fc-trans-zh">{{ currentWord.meaning }}</span>
                </div>
                <!-- AI enrichment loading -->
                <div v-if="enrichLoading" class="fc-enrich-loading">
                  <span class="fc-enrich-spinner" />
                  <span>AI 解析中…</span>
                </div>
                <!-- AI enrichment retry -->
                <button v-else-if="!enhData && enrichError" class="fc-enrich-btn" @click.stop="enrichCurrent">
                  🔄 重新解析
                </button>
                <!-- AI enrichment content -->
                <template v-else-if="enhData">
                  <div v-if="enhData.similar?.length" class="fc-bc-section">
                    <span class="fc-bc-label">相近表达</span>
                    <div class="fc-related-words">
                      <span v-for="w in enhData.similar" :key="w" class="fc-related-word">{{ w }}</span>
                    </div>
                  </div>
                  <button v-if="enhData.funFact" class="fc-story-tab" @click.stop="openStory">📖 查看趣味知识</button>
                </template>
              </template>

            </div>
          </div>
        </div>

        <!-- story panel -->
        <div
          class="fc-story-panel"
          :class="{ open: storyOpen }"
          :style="{ '--accent': accentColor }"
        >
          <button class="fc-story-close" @click.stop="closeStory" aria-label="关闭">×</button>
          <div class="fc-story-eyebrow">趣味知识</div>
          <div class="fc-story-title">{{ enhData?.funFact?.title || '' }}</div>
          <div class="fc-story-body">{{ enhData?.funFact?.body || '' }}</div>
        </div>
      </div>
    </div>

    <!-- empty state -->
    <div v-if="!queue.length && !loading" class="fc-empty">
      <div class="fc-empty-icon">🎉</div>
      <p>{{ isAllMastered ? '全部掌握！' : '当前没有需要学习的卡片' }}</p>
      <button @click="resetQueue">重新开始</button>
    </div>

    <!-- face dots -->
    <div v-if="queue.length" class="fc-dots">
      <span :class="{ active: !flipped && !storyOpen }" />
      <span :class="{ active: flipped && !storyOpen }" />
      <span :class="{ active: storyOpen }" />
    </div>

    <!-- deck nav -->
    <div v-if="queue.length" class="fc-nav">
      <button class="fc-nav-btn" @click="prevCard" :disabled="currentIdx <= 0">←</button>
      <div class="fc-review-actions">
        <button class="fc-review-btn fc-again" @click="rate('again')">🔁 再练一次</button>
        <button class="fc-review-btn fc-known" @click="rate('good')">✓ 记住了</button>
      </div>
      <button class="fc-nav-btn" @click="nextCard" :disabled="currentIdx >= queue.length - 1">→</button>
    </div>

    <!-- toast -->
    <div class="fc-toast" :class="{ show: toastMsg }">{{ toastMsg }}</div>
  </div>
</template>

<script setup lang="ts">
import { usePronunciation } from '~/composables/usePronunciation'

// Apply flashcard page classes to html/body (required by global CSS)
useHead({
  htmlAttrs: { class: 'fc-page' },
  bodyAttrs: { class: 'fc-page' },
})

const route = useRoute()
const bookId = route.params.id as string
const backUrl = computed(() =>
  sourceFromQuery ? `/wordbooks/book/${sourceFromQuery}` : `/wordbooks/${bookId}`
)

interface Word {
  id: string; word: string; phonetic: string; meaning: string; example: string
  phase: string; learnCorrect: number; ease: number; interval: number; repetitions: number
  nextReview: string; pos: string; bookId?: string; enhancement?: string
  cardType?: string; __index?: number
}

interface EnhData {
  phonetic?: string; meaning?: string; example?: string; exampleZh?: string
  roots?: Array<{ part: string; note: string }>; rootNote?: string
  related?: string[]; similar?: string[]; translation?: string
  funFact?: { title: string; body: string }; pos?: string
}

const typeOptions = [
  { key: 'word', label: '单词' },
  { key: 'phrase', label: '短语' },
  { key: 'sentence', label: '句子' },
  { key: 'mixed', label: '混合' },
]

const catMeta: Record<string, { label: string; stamp: string; accent: string; accentSoft: string }> = {
  word: { label: 'WORD · 词汇卡', stamp: '词', accent: '#5668a8', accentSoft: '#8a95cc' },
  phrase: { label: 'PHRASE · 短语卡', stamp: '语', accent: '#a04a3a', accentSoft: '#c88070' },
  sentence: { label: 'SENTENCE · 句子卡', stamp: '句', accent: '#4a7a5a', accentSoft: '#7aaa8a' },
  mixed: { label: 'MIXED · 综合卡', stamp: '卡', accent: '#b89230', accentSoft: '#d4b860' },
}

const words = ref<Word[]>([])
const queue = ref<Word[]>([])
const currentIdx = ref(0)
const flipped = ref(false)
const storyOpen = ref(false)
const loading = ref(true)
const cardType = ref('word')
const showSettings = ref(false)
const enrichLoading = ref(false)
const enrichError = ref(false)
const isSpeaking = ref(false)
const toastMsg = ref('')
let toastTimer: any = null

const settings = reactive({ autoSpeak: false, showZh: true })
const { pronounceSimple } = usePronunciation()

const effectiveType = computed(() => currentWord.value?.cardType || cardType.value)
const catLabel = computed(() => catMeta[effectiveType.value]?.label || '')
const stampChar = computed(() => catMeta[effectiveType.value]?.stamp || '')
const accentColor = computed(() => catMeta[effectiveType.value]?.accent || '#5668a8')
const accentSoft = computed(() => catMeta[effectiveType.value]?.accentSoft || '#8a95cc')
const currentWord = computed(() => queue.value[currentIdx.value] || null)
const isAllMastered = computed(() => words.value.length > 0 && words.value.every(w => w.phase === 'mastered'))

const enhData = computed<EnhData | null>(() => {
  if (!currentWord.value?.enhancement) return null
  try { return JSON.parse(currentWord.value.enhancement) } catch { return null }
})

function pad(n: number) { return String(n).padStart(3, '0').slice(-2) }

function showToast(msg: string) {
  toastMsg.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMsg.value = '' }, 1400)
}

// ── data loading ──
const dailyDate = (route.query.dailyDate as string) || ''
const sourceFromQuery = (route.query.source as string) || ''
const queryType = (route.query.type as string) || 'word'

// 初始 tab：优先用 URL 的 type 参数（从文字本进入时传 type=phrase 等）
if (queryType && ['word', 'phrase', 'sentence', 'mixed'].includes(queryType)) {
  cardType.value = queryType
}

function sourceBookId(type: string) {
  return ({
    word: 'wb_default',
    phrase: 'wb_phrases',
    sentence: 'wb_sentences',
  })[type] || 'wb_default'
}

// 从文字本进入时，bookId 随 tab 类型变化
const effectiveBookId = computed(() =>
  sourceFromQuery ? sourceBookId(cardType.value) : bookId
)

async function loadWords() {
  loading.value = true
  try {
    const params = new URLSearchParams({ type: cardType.value })
    if (dailyDate) {
      params.set('dailyDate', dailyDate)
      params.set('dailyType', cardType.value)
    } else {
      params.set('bookId', effectiveBookId.value)
      if (sourceFromQuery) params.set('source', sourceFromQuery)
    }
    const data = await $fetch<{ words: Word[] }>(`/api/wordbooks/flashcard-words?${params}`)
    words.value = data.words.map((w, i) => ({ ...w, __index: i + 1 }))
  } catch { words.value = [] }
  loading.value = false
  buildQueue()
}

function buildQueue() {
  let list = words.value.filter(w => w.phase !== 'mastered')
  list.sort((a, b) => {
    if (a.phase === 'learn' && b.phase !== 'learn') return -1
    if (b.phase === 'learn' && a.phase !== 'learn') return 1
    return 0
  })
  queue.value = list
  currentIdx.value = 0
  flipped.value = false
  storyOpen.value = false
}

async function switchType(type: string) {
  cardType.value = type
  await loadWords()
}

// ── card actions ──
function onCardClick() {
  if (storyOpen.value) { closeStory(); return }
  flipped.value = !flipped.value
  if (flipped.value && settings.autoSpeak && effectiveType.value === 'word') {
    setTimeout(() => pronounceCurrent(), 350)
  }
  // 翻到背面时自动触发 AI 解析
  if (flipped.value && !enhData.value && !enrichLoading.value) {
    enrichCurrent()
  }
}

function pronounceCurrent() {
  if (!currentWord.value || effectiveType.value !== 'word') return
  isSpeaking.value = true
  pronounceSimple(currentWord.value.word)
  setTimeout(() => { isSpeaking.value = false }, 1500)
}

function openStory() {
  if (!enhData.value?.funFact) return
  storyOpen.value = true
}

function closeStory() {
  storyOpen.value = false
}

async function enrichCurrent() {
  if (enrichLoading.value || !currentWord.value) return
  enrichLoading.value = true
  enrichError.value = false
  try {
    const res = await $fetch<EnhData & { wordId: string }>(
      `/api/wordbooks/${currentWord.value.bookId || bookId}/words/flashcard-enrich`,
      { method: 'POST', body: { wordId: currentWord.value.id, type: effectiveType.value } }
    )
    if (currentWord.value) {
      currentWord.value.enhancement = JSON.stringify(res)
      const idx = words.value.findIndex(w => w.id === currentWord.value!.id)
      if (idx >= 0) words.value[idx].enhancement = currentWord.value.enhancement
    }
  } catch {
    enrichError.value = true
    showToast('AI 解析失败，可点击重试')
  }
  finally { enrichLoading.value = false }
}

// ── navigation ──
function prevCard() {
  if (currentIdx.value <= 0) return
  currentIdx.value--
  flipped.value = false
  storyOpen.value = false
  enrichError.value = false
}

function nextCard() {
  if (currentIdx.value >= queue.value.length - 1) return
  currentIdx.value++
  flipped.value = false
  storyOpen.value = false
  enrichError.value = false
}

// ── rating ──
async function rate(grade: 'again' | 'hard' | 'good' | 'easy') {
  if (!currentWord.value) return
  const w = currentWord.value

  let phase = w.phase
  let learnCorrect = w.learnCorrect
  let learnTotal = (w as any).learnTotal || 0
  let learnWrong = (w as any).learnWrong || 0
  let ease = w.ease || 2.5
  let interval = w.interval || 0
  let repetitions = w.repetitions || 0
  let nextReview = ''

  learnTotal++

  if (grade === 'again') {
    learnWrong++
    learnCorrect = 0
    if (phase === 'review') { interval = 1; ease = Math.max(1.3, ease - 0.2) }
  } else {
    learnCorrect++
    if (grade === 'hard') { interval = Math.max(1, Math.round(interval * 1.2)) }
    else if (grade === 'good') { interval = Math.max(1, Math.round((interval || 1) * ease)) }
    else { interval = Math.max(1, Math.round((interval || 1) * ease * 1.3)); ease = Math.min(3.0, ease + 0.15) }
    repetitions++
  }

  if (phase === 'learn' && learnCorrect >= 3) { phase = 'review'; interval = 1 }
  if (phase === 'review' && grade !== 'again') {
    const d = new Date(); d.setDate(d.getDate() + interval); nextReview = d.toISOString()
  }
  if (phase === 'review' && grade === 'easy' && interval >= 21) { phase = 'mastered' }

  await $fetch(`/api/wordbooks/${w.bookId || bookId}/words/${w.id}`, {
    method: 'PATCH',
    body: { phase, learnCorrect, learnTotal, learnWrong, ease, interval, repetitions, nextReview },
  })

  w.phase = phase; w.learnCorrect = learnCorrect
  w.ease = ease; w.interval = interval; w.repetitions = repetitions; w.nextReview = nextReview

  showToast(grade === 'again' ? '已加入复习队列' : '太棒了，已标记为「记住了」')

  if (currentIdx.value < queue.value.length - 1) {
    nextCard()
  } else {
    buildQueue()
    showToast(queue.value.length ? '进入下一轮' : '全部掌握！')
  }
}

async function resetQueue() {
  for (const w of words.value) {
    if (w.phase === 'mastered') {
      await $fetch(`/api/wordbooks/${w.bookId || bookId}/words/${w.id}`, {
        method: 'PATCH',
        body: { phase: 'learn', learnCorrect: 0, interval: 0, repetitions: 0, nextReview: '' },
      })
    }
  }
  await loadWords()
}

// keyboard
function onKey(e: KeyboardEvent) {
  if (showSettings.value) return
  if (e.key === ' ' || e.key === 'Space') { e.preventDefault(); onCardClick(); return }
  if (e.key === 'Enter') { e.preventDefault(); onCardClick(); return }
  if (e.key === 'ArrowLeft') { e.preventDefault(); prevCard(); return }
  if (e.key === 'ArrowRight') { e.preventDefault(); nextCard(); return }
  if (e.key === 'Escape' && storyOpen.value) { closeStory(); return }
  if (!flipped.value) return
  if (e.key === '1') rate('again')
  if (e.key === '2') rate('hard')
  if (e.key === '3') rate('good')
  if (e.key === '4') rate('easy')
}

onMounted(() => { loadWords(); window.addEventListener('keydown', onKey); document.addEventListener('click', () => { showSettings.value = false }) })
onUnmounted(() => { window.removeEventListener('keydown', onKey) })
</script>

<style>
/* ── global: dark bg + CSS variables + all card styles (no scoped, matching flashcard.html) ── */

:root {
  --bg: #1b140f; --bg-2: #241b14;
  --paper: #ffffff; --paper-back: #f5f5f5; --paper-edge: #d0d0d0;
  --text-dark: #000000; --text-muted: #666666;
  --story-bg: #152137; --story-bg-2: #1c2c47;
  --gold: #c9a24b; --gold-soft: #e3c789;
  --radius: 14px;
  --mono: 'JetBrains Mono', 'DM Mono', monospace;
  --serif: 'Noto Serif SC', 'Lora', Georgia, serif;
  --sans: 'Noto Sans SC', 'DM Sans', sans-serif;
  --accent: #5668a8; --accent-soft: #8a95cc;
}

html.fc-page, body.fc-page {
  min-height: 100vh; margin: 0;
  background:
    radial-gradient(1200px 800px at 15% -10%, #2a2016 0%, transparent 60%),
    radial-gradient(900px 700px at 110% 10%, #241a12 0%, transparent 55%),
    var(--bg);
  font-family: var(--sans);
  color: #e9dfc4;
  display: flex; flex-direction: column; align-items: center;
  padding: 20px 16px 40px;
}

/* subtle desk grain */
body.fc-page::before {
  content:""; position:fixed; inset:0; pointer-events:none; opacity:.05; mix-blend-mode:overlay; z-index:0;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

.fc-app {
  width: 100%; max-width: 520px; display: flex; flex-direction: column; gap: 14px; z-index: 1;
}

/* ── header ── */
.fc-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.fc-back-btn {
  width: 30px; height: 30px; border-radius: 50%; border: 1px solid rgba(233,223,196,.18);
  background: rgba(255,255,255,.03); color: #e9dfc4;
  display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0;
  transition: background .15s; text-decoration: none;
}
.fc-back-btn:hover { background: rgba(255,255,255,.08); }
.fc-brand { display: flex; align-items: center; gap: 9px; flex: 1; }
.fc-mark {
  width: 30px; height: 30px; border-radius: 7px;
  background: linear-gradient(155deg, var(--paper), var(--paper-back));
  display: flex; align-items: center; justify-content: center;
  font-family: var(--serif); font-weight: 900; color: var(--text-dark); font-size: 14px;
  box-shadow: 0 2px 0 rgba(0,0,0,.25), inset 0 0 0 1px rgba(0,0,0,.08);
  transform: rotate(-4deg);
}
.fc-title { font-family: var(--serif); font-weight: 700; font-size: 16.5px; letter-spacing: .3px; color: #e9dfc4; }
.fc-title small { display: block; font-family: var(--mono); font-size: 9.5px; letter-spacing: 2.5px; color: var(--gold-soft); font-weight: 500; margin-top: 1px; }

.fc-settings-btn {
  width: 34px; height: 34px; border-radius: 50%; border: 1px solid rgba(233,223,196,.18);
  background: rgba(255,255,255,.03); color: #e9dfc4; font-size: 15px;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.fc-settings-btn:hover { background: rgba(255,255,255,.07); }

.fc-settings-pop {
  position: absolute; top: 42px; right: 0; z-index: 20;
  background: var(--story-bg-2); border: 1px solid rgba(233,223,196,.15);
  border-radius: 12px; padding: 14px 16px; width: 200px;
  box-shadow: 0 12px 30px rgba(0,0,0,.4);
  display: flex; flex-direction: column; gap: 10px; font-size: 13px;
}
.fc-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; cursor: pointer; }
.fc-settings-row span { color: #e9dfc4; opacity: .9; }
.fc-toggle {
  width: 38px; height: 22px; border-radius: 20px; background: rgba(233,223,196,.2);
  position: relative; cursor: pointer; flex-shrink: 0; transition: background .2s;
}
.fc-toggle.on { background: var(--gold); }
.fc-toggle::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%;
  background: #fff; transition: transform .2s;
}
.fc-toggle.on::after { transform: translateX(16px); }
.fc-settings-close {
  margin-top: 4px; padding: 6px 12px; border: none; border-radius: 8px;
  background: rgba(255,255,255,.08); color: #e9dfc4; cursor: pointer; font-size: 12px; font-family: var(--sans);
}

/* ── type tabs ── */
.fc-tabs { display: flex; gap: 6px; background: rgba(255,255,255,.03); padding: 4px; border-radius: 11px; border: 1px solid rgba(233,223,196,.1); }
.fc-tabs button {
  flex: 1; border: none; background: transparent; color: #e9dfc4; opacity: .55;
  font-family: var(--sans); font-size: 13px; font-weight: 600; padding: 8px 10px; border-radius: 8px;
  cursor: pointer; transition: all .2s; letter-spacing: .3px;
}
.fc-tabs button.active { opacity: 1; background: rgba(255,255,255,.08); box-shadow: inset 0 0 0 1px rgba(233,223,196,.12); }
.fc-tabs button[data-type="word"].active { color: #a9b6ef; }
.fc-tabs button[data-type="phrase"].active { color: #e2a493; }
.fc-tabs button[data-type="sentence"].active { color: #9fcaad; }
.fc-tabs button[data-type="mixed"].active { color: #d4b860; }

/* ── deck info ── */
.fc-deck-info { display: flex; align-items: center; justify-content: space-between; padding: 0 2px; }
.fc-cat-label { font-family: var(--mono); font-size: 11px; color: var(--text-muted); opacity: .8; text-transform: uppercase; letter-spacing: 1.5px; }
.fc-count { font-family: var(--mono); font-size: 12px; color: var(--gold-soft); letter-spacing: .5px; }

/* ── empty ── */
.fc-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 60px 20px; }
.fc-empty-icon { font-size: 48px; }
.fc-empty p { font-family: var(--sans); font-size: 14px; color: #a09e97; margin: 0; }
.fc-empty button {
  padding: 10px 24px; border: 1px solid rgba(233,223,196,.15); border-radius: 8px;
  background: rgba(255,255,255,.04); color: #e9dfc4; cursor: pointer; font-size: 14px; font-family: var(--sans);
}
.fc-empty button:hover { background: rgba(255,255,255,.08); }

/* ── stage ── */
.fc-stage { position: relative; width: 100%; height: clamp(400px, 58vh, 500px); overflow: hidden; }

.fc-peek {
  position: absolute; inset: 10px 6px -10px 6px; border-radius: var(--radius);
  background: var(--paper-back); opacity: .5; transform: rotate(2.4deg) scale(.97);
  box-shadow: 0 10px 24px rgba(0,0,0,.35);
}
.fc-peek::after {
  content: ""; position: absolute; inset: 0; border-radius: inherit;
  background: repeating-linear-gradient(0deg, transparent 0 27px, rgba(0,0,0,.035) 27px 28px);
}

/* ── 3D flip card ── */
.fc-flip-card {
  position: absolute; inset: 0; perspective: 1600px; cursor: pointer; outline: none;
}
.fc-flip-inner {
  position: relative; width: 100%; height: 100%;
  transition: transform .55s cubic-bezier(.4,.2,.2,1);
  transform-style: preserve-3d;
}
.fc-flip-card.flipped .fc-flip-inner { transform: rotateY(180deg); }

.fc-face {
  position: absolute; inset: 0;
  -webkit-backface-visibility: hidden; backface-visibility: hidden;
  border-radius: var(--radius); background: var(--paper);
  box-shadow: 0 4px 0 var(--paper-edge), 0 18px 34px rgba(0,0,0,.4);
  padding: 26px 24px 22px; display: flex; flex-direction: column;
  overflow-y: auto; scrollbar-width: thin;
}
.fc-face::-webkit-scrollbar { width: 5px; }
.fc-face::-webkit-scrollbar-thumb { background: rgba(0,0,0,.15); border-radius: 6px; }
.fc-back { transform: rotateY(180deg); background: var(--paper-back); }

/* ruled paper texture */
.fc-face::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: repeating-linear-gradient(0deg, transparent 0 30px, rgba(0,0,0,.028) 30px 31px);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0 58px, black 90px);
  mask-image: linear-gradient(to bottom, transparent 0 58px, black 90px);
}

/* stamp badge */
.fc-stamp {
  position: absolute; top: 14px; left: 16px; z-index: 2;
  width: 40px; height: 40px; border-radius: 50%;
  border: 2px solid var(--accent); color: var(--accent);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--serif); font-weight: 700; font-size: 15px;
  transform: rotate(-9deg); opacity: .85;
  box-shadow: 0 0 0 1px rgba(0,0,0,.02);
}
.fc-stamp::after {
  content: ""; position: absolute; inset: -5px; border-radius: 50%; border: 1px dashed var(--accent); opacity: .5;
}

.fc-catalog {
  position: absolute; top: 18px; right: 18px; z-index: 2;
  font-family: var(--mono); font-size: 10.5px; color: var(--text-muted); letter-spacing: 1px;
}

/* front content */
.fc-front-content { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center; padding-top: 20px; }
.fc-headword {
  font-family: var(--serif); font-weight: 900; font-size: clamp(30px, 8vw, 42px); color: var(--text-dark); line-height: 1.15;
}
.fc-headword--phrase, .fc-headword--sentence { font-size: clamp(21px, 6vw, 27px); font-weight: 700; line-height: 1.4; max-width: 340px; }

.fc-speak-btn {
  width: 44px; height: 44px; border-radius: 50%; border: 1.5px solid var(--accent);
  background: rgba(255,255,255,.4); color: var(--accent); font-size: 18px;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  transition: transform .15s, background .15s;
}
.fc-speak-btn:active { transform: scale(.92); }
.fc-speak-btn.speaking { background: var(--accent); color: #fff; }

.fc-tap-hint { font-family: var(--sans); font-size: 11.5px; color: var(--text-muted); letter-spacing: .4px; margin-top: 2px; }

/* back content */
.fc-back-content { flex: 1; display: flex; flex-direction: column; gap: 14px; padding-top: 26px; }
.fc-bc-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.fc-bc-word { font-family: var(--serif); font-weight: 800; font-size: 22px; color: var(--text-dark); }
.fc-bc-ipa { font-family: var(--mono); font-size: 13px; color: var(--accent); }
.fc-bc-meaning { font-family: var(--sans); font-size: 14.5px; color: var(--text-dark); font-weight: 600; }

.fc-bc-section { display: flex; flex-direction: column; gap: 5px; }
.fc-bc-label {
  font-family: var(--mono); font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase;
  color: var(--accent); opacity: .85; font-weight: 600;
}
.fc-bc-example { font-family: var(--sans); font-size: 13.5px; color: var(--text-dark); line-height: 1.55; font-style: italic; }
.fc-bc-example-zh { display: block; font-style: normal; color: var(--text-muted); font-size: 12.5px; margin-top: 2px; }

.fc-root-parts { display: flex; flex-wrap: wrap; gap: 6px; }
.fc-root-chip {
  font-family: var(--mono); font-size: 11.5px; padding: 4px 9px; border-radius: 7px;
  background: rgba(0,0,0,.05); border: 1px solid rgba(0,0,0,.08); color: var(--text-dark);
}
.fc-root-chip b { color: var(--accent); }
.fc-root-note { font-family: var(--sans); font-size: 12.5px; color: var(--text-muted); line-height: 1.5; }

.fc-related-words { display: flex; flex-wrap: wrap; gap: 7px; }
.fc-related-word {
  font-family: var(--serif); font-size: 13px; font-weight: 600; color: var(--accent);
  padding: 4px 10px; border-radius: 20px; border: 1px solid var(--accent); opacity: .85;
}

.fc-translation-block { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; text-align: center; padding: 10px 6px; }
.fc-trans-en { font-family: var(--sans); font-size: 12px; color: var(--text-muted); font-style: italic; }
.fc-trans-zh { font-family: var(--serif); font-size: 22px; font-weight: 700; color: var(--text-dark); line-height: 1.5; }

/* enrich loading / retry */
.fc-enrich-loading {
  margin-top: auto; align-self: center;
  display: flex; align-items: center; gap: 8px;
  font-family: var(--sans); font-size: 12.5px; color: var(--text-muted);
  padding: 8px 0;
}
.fc-enrich-spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(0,0,0,.12); border-top-color: var(--accent);
  animation: fc-spin .7s linear infinite;
}
@keyframes fc-spin { to { transform: rotate(360deg); } }

.fc-enrich-btn {
  margin-top: auto; align-self: center;
  padding: 8px 16px; border-radius: 20px; border: 1px solid rgba(0,0,0,.12);
  background: rgba(255,255,255,.4); color: var(--text-dark);
  font-family: var(--sans); font-size: 12.5px; font-weight: 600; cursor: pointer;
  transition: transform .15s;
}
.fc-enrich-btn:hover { filter: brightness(.95); }

/* story tab button */
.fc-story-tab {
  margin-top: auto; align-self: center;
  display: flex; align-items: center; gap: 6px;
  background: var(--story-bg); color: var(--gold-soft);
  font-family: var(--sans); font-size: 12.5px; font-weight: 600;
  padding: 8px 16px; border-radius: 20px; cursor: pointer; border: none;
  box-shadow: 0 6px 14px rgba(0,0,0,.25);
  transition: transform .15s;
}
.fc-story-tab:active { transform: scale(.96); }

/* story panel */
.fc-story-panel {
  position: absolute; inset: 0; border-radius: var(--radius);
  background:
    radial-gradient(500px 300px at 100% 0%, var(--story-bg-2) 0%, transparent 60%),
    var(--story-bg);
  color: #e9dfc4;
  padding: 24px 24px 20px;
  display: flex; flex-direction: column; gap: 12px;
  transform: translateX(105%);
  transition: transform .45s cubic-bezier(.4,.15,.2,1);
  box-shadow: 0 18px 34px rgba(0,0,0,.45);
  z-index: 5;
}
.fc-story-panel.open { transform: translateX(0); }
.fc-story-close {
  position: absolute; top: 14px; right: 14px; width: 30px; height: 30px; border-radius: 50%;
  border: 1px solid rgba(233,223,196,.25); background: rgba(255,255,255,.04); color: #e9dfc4;
  cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center;
}
.fc-story-eyebrow {
  display: flex; align-items: center; gap: 8px;
  font-family: var(--mono); font-size: 10.5px; letter-spacing: 2px;
  color: var(--gold); text-transform: uppercase;
}
.fc-story-eyebrow::before { content: ""; width: 16px; height: 1px; background: var(--gold); }
.fc-story-title { font-family: var(--serif); font-weight: 700; font-size: 19px; line-height: 1.4; padding-right: 24px; }
.fc-story-body { font-family: var(--sans); font-size: 13.5px; line-height: 1.8; opacity: .92; overflow-y: auto; }

/* face dots */
.fc-dots { display: flex; justify-content: center; gap: 6px; }
.fc-dots span { width: 6px; height: 6px; border-radius: 50%; background: rgba(233,223,196,.2); transition: background .2s, transform .2s; }
.fc-dots span.active { background: var(--gold); transform: scale(1.3); }

/* deck nav */
.fc-nav { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.fc-nav-btn {
  width: 42px; height: 42px; border-radius: 50%; border: 1px solid rgba(233,223,196,.18);
  background: rgba(255,255,255,.03); color: #e9dfc4; font-size: 16px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background .15s;
}
.fc-nav-btn:hover { background: rgba(255,255,255,.08); }
.fc-nav-btn:disabled { opacity: .3; cursor: default; }

.fc-review-actions { display: flex; gap: 8px; flex: 1; }
.fc-review-btn {
  flex: 1; border: none; border-radius: 11px; padding: 11px 8px;
  font-family: var(--sans); font-size: 12.5px; font-weight: 600; cursor: pointer;
  transition: transform .12s, filter .12s;
  display: flex; align-items: center; justify-content: center; gap: 5px;
}
.fc-review-btn:active { transform: scale(.96); }
.fc-again { background: rgba(138,58,46,.18); color: #e2a493; border: 1px solid rgba(138,58,46,.4); }
.fc-known { background: rgba(58,90,69,.22); color: #9fcaad; border: 1px solid rgba(58,90,69,.45); }

/* toast */
.fc-toast {
  position: fixed; bottom: 22px; left: 50%; z-index: 30;
  transform: translateX(-50%) translateY(20px);
  background: var(--story-bg-2); color: #e9dfc4;
  font-family: var(--sans); font-size: 13px;
  padding: 10px 18px; border-radius: 20px;
  opacity: 0; transition: opacity .25s, transform .25s;
  pointer-events: none;
  box-shadow: 0 10px 24px rgba(0,0,0,.4); border: 1px solid rgba(233,223,196,.12);
}
.fc-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

/* ── responsive ── */

/* mobile compact */
@media (max-width: 420px) {
  .fc-app { gap: 10px; }
  .fc-headword { font-size: clamp(26px, 9vw, 34px); }
  .fc-face { padding: 22px 18px 18px; }
}
</style>
