<template>
  <div class="cards-page">
    <header class="cards-header">
      <NuxtLink :to="`/wordbooks/${bookId}`" class="cards-back">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="15 18 9 12 15 6"/></svg>
        返回
      </NuxtLink>
      <span class="cards-progress">{{ currentIdx + 1 }} / {{ queue.length }}</span>
      <button class="cards-settings-btn" @click="showSettings = !showSettings" title="设置">⚙</button>
    </header>

    <!-- 设置面板 -->
    <div v-if="showSettings" class="cards-settings" @click.self="showSettings = false">
      <div class="cards-settings-card">
        <label><input type="checkbox" v-model="settings.randomOrder"> 随机顺序</label>
        <label><input type="checkbox" v-model="settings.autoPlay"> 自动播放</label>
        <label><input type="checkbox" v-model="settings.spellMode"> 拼写模式</label>
        <div v-if="settings.autoPlay" class="cards-settings-row">
          <span>间隔秒数</span>
          <input type="number" v-model.number="settings.autoDelay" min="2" max="10" style="width:50px" />
        </div>
        <div v-if="settings.autoPlay" class="cards-settings-row">
          <span>读音次数</span>
          <input type="number" v-model.number="settings.pronounceCount" min="1" max="5" style="width:50px" />
        </div>
        <button @click="showSettings = false">关闭</button>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="!queue.length && !loading" class="cards-empty">
      <div class="cards-empty-icon">🎉</div>
      <p>{{ isAllMastered ? '全部掌握！' : '当前没有需要学习的单词' }}</p>
      <button @click="resetQueue">重新开始</button>
    </div>

    <!-- 卡片 -->
    <div v-if="queue.length && currentWord" class="cards-body">
      <div class="cards-card-area">
        <button class="cards-arrow cards-arrow--left" @click.stop="prevWord" :disabled="currentIdx <= 0" title="上一个 (←)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div
          class="cards-stage"
          :style="stageStyle"
          @mousedown="startDrag"
          @touchstart.prevent="startTouchDrag"
        >
          <div class="card" :class="{ flipped }" @click="onCardClick">
            <!-- 正面：单词 -->
            <div class="card-face card-front">
              <div v-if="!settings.spellMode" class="card-content">
                <div class="card-word">{{ currentWord.word }}</div>
                <button class="card-flip-btn front-flip-btn" @click.stop="onCardClick">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><polyline points="9 10 6 12 9 14"/><polyline points="15 10 18 12 15 14"/></svg>
                  查看释义
                </button>
                <button class="card-enrich-btn" @click.stop="enrichCurrent" :disabled="enrichLoading">
                  <template v-if="enrichLoading">⋯</template>
                  <template v-else>AI 释义</template>
                </button>
              </div>
              <div v-else class="card-content">
                <div class="card-meaning-big">{{ currentWord.meaning }}</div>
                <input ref="spellInput" v-model="spellAnswer" class="card-spell-input" placeholder="拼写单词…" @keydown.enter="checkSpell" />
                <button class="card-spell-btn" @click.stop="checkSpell">确认</button>
              </div>
            </div>

            <!-- 背面：释义 -->
            <div class="card-face card-back">
              <div class="card-content">
                <div class="card-word-row">
                  <span class="card-word">{{ currentWord.word }}</span>
                  <span v-if="currentWord.phase" class="card-phase" :class="'card-phase--' + currentWord.phase">
                    {{ phaseLabel(currentWord.phase) }}
                  </span>
                  <button v-if="!isSentenceBook" class="card-pronounce-btn" @click.stop="pronounceCurrent" title="发音">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
                    </svg>
                  </button>
                </div>
                <div v-if="!isSentenceBook" class="card-phonetic">{{ currentWord.phonetic }}</div>
                <div class="card-meaning-big">{{ currentWord.meaning }}</div>
                <div v-if="currentWord.example" class="card-example">"{{ currentWord.example }}"</div>
              </div>
            </div>
          </div>
        </div>
        <button class="cards-arrow cards-arrow--right" @click.stop="nextWord" :disabled="currentIdx >= queue.length - 1" title="下一个 (→)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      <!-- 评级按钮 (翻面后显示) -->
      <div v-if="flipped" class="cards-rating">
        <button class="rate-btn rate-again" @click="rate('again')">
          <span class="rate-key">1</span> 忘记
        </button>
        <button class="rate-btn rate-hard" @click="rate('hard')">
          <span class="rate-key">2</span> 困难
        </button>
        <button class="rate-btn rate-good" @click="rate('good')">
          <span class="rate-key">3</span> 良好
        </button>
        <button class="rate-btn rate-easy" @click="rate('easy')">
          <span class="rate-key">4</span> 简单
        </button>
      </div>
    </div>

    <!-- 自动播放计时器 -->
    <div v-if="settings.autoPlay && autoTimer > 0" class="cards-timer">{{ autoTimer }}s</div>
  </div>
</template>

<script setup lang="ts">
import { nextTick } from 'vue'
const route = useRoute()
const bookId = route.params.id as string

interface Word { id: string; word: string; phonetic: string; meaning: string; example: string; phase: string; learnCorrect: number; ease: number; interval: number; repetitions: number; nextReview: string; pos: string }

const words = ref<Word[]>([])
const queue = ref<Word[]>([])
const currentIdx = ref(0)
const flipped = ref(false)
const loading = ref(true)
const spellAnswer = ref('')
const spellInput = ref<HTMLInputElement>()
const showSettings = ref(false)
const autoTimer = ref(0)
let autoInterval: any = null

const settings = reactive({
  randomOrder: false,
  autoPlay: false,
  spellMode: false,
  autoDelay: 4,
  pronounceCount: 1,
})

// ── 卡片拖拽 ──
const cardX = ref(0)
const cardY = ref(0)
const isDragging = ref(false)
let dragStartX = 0
let dragStartY = 0
let dragMoved = false
const DRAG_THRESHOLD = 4

const stageStyle = computed(() => ({
  transform: `translate(${cardX.value}px, ${cardY.value}px)`,
  cursor: isDragging.value ? 'grabbing' : 'grab',
}))

function startDrag(e: MouseEvent) {
  if (settings.spellMode) { flip(); return }
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragMoved = false
  isDragging.value = true

  const onMove = (ev: MouseEvent) => {
    const dx = ev.clientX - dragStartX
    const dy = ev.clientY - dragStartY
    if (!dragMoved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      dragMoved = true
    }
    if (dragMoved) {
      cardX.value += ev.movementX
      cardY.value += ev.movementY
    }
  }

  const onUp = () => {
    isDragging.value = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function startTouchDrag(e: TouchEvent) {
  if (settings.spellMode) { flip(); return }
  if (!e.touches.length) return
  const t = e.touches[0]
  dragStartX = t.clientX
  dragStartY = t.clientY
  dragMoved = false
  isDragging.value = true

  const onMove = (ev: TouchEvent) => {
    if (!ev.touches.length) return
    const t2 = ev.touches[0]
    const dx = t2.clientX - dragStartX
    const dy = t2.clientY - dragStartY
    if (!dragMoved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      dragMoved = true
    }
    if (dragMoved) {
      cardX.value = t2.clientX - dragStartX
      cardY.value = t2.clientY - dragStartY
    }
  }

  const onEnd = () => {
    isDragging.value = false
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
  }

  document.addEventListener('touchmove', onMove, { passive: false })
  document.addEventListener('touchend', onEnd)
}

const currentWord = computed(() => queue.value[currentIdx.value] || null)
const isAllMastered = computed(() => words.value.length > 0 && words.value.every(w => w.phase === 'mastered'))
const isSentenceBook = computed(() => bookId === 'wb_sentences')

function buildQueue() {
  let list = words.value.filter(w => w.phase !== 'mastered')
  // 优先未学习的
  list.sort((a, b) => {
    if (a.phase === 'learn' && b.phase !== 'learn') return -1
    if (b.phase === 'learn' && a.phase !== 'learn') return 1
    return 0
  })
  if (settings.randomOrder) list = shuffle(list)
  queue.value = list
  currentIdx.value = 0
  flipped.value = false
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function onCardClick() {
  if (settings.spellMode) return
  if (dragMoved) { dragMoved = false; return }
  if (flipped.value) {
    skipWord()
    return
  }
  flipped.value = true
  if (flipped.value && settings.autoPlay) startAutoTimer()
}

function flip() { onCardClick() } // 供外部调用

async function skipWord() {
  await nextCard()
}

function phaseLabel(p: string) {
  if (p === 'learn' || p === 'lear') return '学习中'
  if (p === 'review') return '复习中'
  if (p === 'mastered') return '已掌握'
  return ''
}

function pronounceCurrent() {
  if (!currentWord.value) return
  const w = currentWord.value.word.replace(/[^a-zA-Z]/g, '').toLowerCase()
  const audio = new Audio(`https://audio.beingfine.cn/speeches/UK/UK-speech/${w}.mp3`)
  audio.play().catch(() => {
    const u = new SpeechSynthesisUtterance(currentWord.value!.word)
    u.lang = 'en-GB'; u.rate = 0.85
    speechSynthesis.speak(u)
  })
}

const enrichLoading = ref(false)
async function enrichCurrent() {
  if (enrichLoading.value || !currentWord.value) return
  enrichLoading.value = true
  try {
    const res = await $fetch<{ phonetic: string; meaning: string; example: string; note: string }>(
      `/api/wordbooks/${bookId}/words/enrich`,
      { method: 'POST', body: { wordId: currentWord.value.id } }
    )
    if (currentWord.value) {
      currentWord.value.phonetic = res.phonetic
      currentWord.value.meaning = res.meaning
      currentWord.value.example = res.example
    }
  } catch {}
  finally { enrichLoading.value = false }
}

function checkSpell() {
  if (!currentWord.value) return
  const correct = spellAnswer.value.trim().toLowerCase() === currentWord.value.word.toLowerCase()
  if (correct) {
    rate('good')
  } else {
    alert(`正确答案: ${currentWord.value.word}`)
    rate('again')
  }
  spellAnswer.value = ''
}

async function rate(grade: 'again' | 'hard' | 'good' | 'easy') {
  if (!currentWord.value) return
  const w = currentWord.value

  let phase = w.phase
  let learnCorrect = w.learnCorrect
  let learnTotal = w.learnTotal + 1
  let learnWrong = w.learnWrong
  let ease = w.ease || 2.5
  let interval = w.interval || 0
  let repetitions = w.repetitions || 0
  let nextReview = ''

  if (grade === 'again') {
    learnWrong++
    learnCorrect = 0
    if (phase === 'review') {
      interval = 1
      ease = Math.max(1.3, ease - 0.2)
    }
  } else {
    learnCorrect++
    if (grade === 'hard') {
      interval = Math.max(1, Math.round(interval * 1.2))
    } else if (grade === 'good') {
      interval = Math.max(1, Math.round((interval || 1) * ease))
    } else {
      interval = Math.max(1, Math.round((interval || 1) * ease * 1.3))
      ease = Math.min(3.0, ease + 0.15)
    }
    repetitions++
  }

  // 学习阶段：连续 3 次正确 → 进入复习
  if (phase === 'learn' && learnCorrect >= 3) {
    phase = 'review'
    interval = 1
  }

  // 复习阶段：设置下次复习时间
  if (phase === 'review' && grade !== 'again') {
    const d = new Date()
    d.setDate(d.getDate() + interval)
    nextReview = d.toISOString()
  }

  // 标记掌握
  if (phase === 'review' && grade === 'easy' && interval >= 21) {
    phase = 'mastered'
  }

  // 更新 DB
  await $fetch(`/api/wordbooks/${bookId}/words/${w.id}`, {
    method: 'PATCH',
    body: { phase, learnCorrect, learnTotal, learnWrong, ease, interval, repetitions, nextReview },
  })

  // 更新本地
  w.phase = phase; w.learnCorrect = learnCorrect
  w.ease = ease; w.interval = interval; w.repetitions = repetitions; w.nextReview = nextReview

  // 切换到下一个
  await nextCard()
}

async function nextCard() {
  flipped.value = false
  cardX.value = 0; cardY.value = 0
  clearAutoTimer()
  // 前进到下一词
  currentIdx.value++
  // 队列耗尽则重建（排除已掌握的）
  if (currentIdx.value >= queue.value.length) {
    buildQueue()
  }
  // 自动播放模式：自动翻到背面，启动读音+计时
  if (settings.autoPlay && queue.value.length > 0) {
    await nextTick()
    flipped.value = true
    startAutoTimer()
  }
}

function prevWord() {
  if (currentIdx.value <= 0) return
  flipped.value = false
  cardX.value = 0; cardY.value = 0
  clearAutoTimer()
  currentIdx.value--
}

async function nextWord() {
  if (currentIdx.value >= queue.value.length - 1) return
  flipped.value = false
  cardX.value = 0; cardY.value = 0
  clearAutoTimer()
  currentIdx.value++
  if (settings.autoPlay) {
    await nextTick()
    flipped.value = true
    startAutoTimer()
  }
}

function startAutoTimer() {
  clearAutoTimer()
  autoTimer.value = settings.autoDelay
  let pronCount = 0

  // 首次发音
  pronounceCurrent()
  pronCount++

  autoInterval = setInterval(() => {
    // 剩余读音
    if (pronCount < settings.pronounceCount) {
      pronounceCurrent()
      pronCount++
    }
    // 倒计时
    autoTimer.value--
    if (autoTimer.value <= 0) {
      clearAutoTimer()
      rate('good')
    }
  }, 1000)
}
function clearAutoTimer() { if (autoInterval) { clearInterval(autoInterval); autoInterval = null }; autoTimer.value = 0 }

async function resetQueue() {
  for (const w of words.value) {
    if (w.phase === 'mastered') {
      await $fetch(`/api/wordbooks/${bookId}/words/${w.id}`, {
        method: 'PATCH',
        body: { phase: 'learn', learnCorrect: 0, interval: 0, repetitions: 0, nextReview: '' },
      })
    }
  }
  await load()
}

async function load() {
  loading.value = true
  try { words.value = await $fetch<Word[]>(`/api/wordbooks/${bookId}/words`) } catch {}
  loading.value = false
  buildQueue()
}

// 键盘快捷键
function onKey(e: KeyboardEvent) {
  if (showSettings.value) return
  if (e.key === ' ' || e.key === 'Space' || e.code === 'Space' || e.keyCode === 32) {
    e.preventDefault()
    onCardClick()
    return
  }
  if (e.key === 'Enter') { e.preventDefault(); onCardClick(); return }
  if (e.key === 'ArrowLeft') { e.preventDefault(); prevWord(); return }
  if (e.key === 'ArrowRight') { e.preventDefault(); nextWord(); return }
  if (!flipped.value) return
  if (e.key === '1') rate('again')
  if (e.key === '2') rate('hard')
  if (e.key === '3') rate('good')
  if (e.key === '4') rate('easy')
}

onMounted(() => { load(); window.addEventListener('keydown', onKey) })
onUnmounted(() => { window.removeEventListener('keydown', onKey); clearAutoTimer() })
</script>

<style scoped>
.cards-page { height: 100vh; display: flex; flex-direction: column; background: #f7f6f3; color: #1a1a18; }

.cards-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 20px; height: 50px; flex-shrink: 0;
}
.cards-back { display: flex; align-items: center; gap: 4px; font-size: 13px; color: #8a877c; text-decoration: none; font-family: 'DM Sans', sans-serif; }
.cards-back:hover { color: #3d3591; }
.cards-progress { font-size: 13px; color: #a09e97; font-family: 'DM Mono', monospace; }
.cards-settings-btn { border: none; background: none; font-size: 18px; cursor: pointer; color: #c4c1ba; }
.cards-settings-btn:hover { color: #3d3591; }

.cards-settings {
  position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
}
.cards-settings-card {
  background: #ffffff; border-radius: 12px; padding: 24px; width: 280px;
  display: flex; flex-direction: column; gap: 12px;
  font-size: 14px; font-family: 'DM Sans', sans-serif; color: #1a1a18;
}
.cards-settings-card label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.cards-settings-row { display: flex; align-items: center; gap: 8px; }
.cards-settings-row input { padding: 4px; border: 1px solid #e0ddd5; border-radius: 4px; background: #fafaf8; color: #1a1a18; }
.cards-settings-card button { margin-top: 8px; padding: 8px; border: none; border-radius: 8px; background: #3d3591; color: #fff; cursor: pointer; }

.cards-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; font-family: 'DM Sans', sans-serif; color: #a09e97; }
.cards-empty-icon { font-size: 48px; }
.cards-empty button { padding: 10px 24px; border: 1px solid rgba(0,0,0,0.08); border-radius: 8px; background: #fff; color: #6b6963; cursor: pointer; font-size: 14px; }
.cards-empty button:hover { color: #3d3591; border-color: rgba(61,53,145,0.2); }

.cards-body { flex: 1; display: flex; flex-direction: column; align-items: center; padding: 20px; }

/* ── 卡片区域（箭头 + 卡片） ── */
.cards-card-area { display: flex; align-items: center; justify-content: center; width: 100%; flex: 1; position: relative; }

/* ── 卡片导航箭头 ── */
.cards-arrow {
  position: absolute; top: 50%; transform: translateY(-50%);
  z-index: 10;
  width: 44px; height: 64px;
  border: none; border-radius: 10px;
  background: rgba(0,0,0,0.05);
  color: #a09e97;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.cards-arrow:hover { background: rgba(0,0,0,0.1); color: #3d3591; }
.cards-arrow:disabled { opacity: 0.2; cursor: default; background: transparent; }
.cards-arrow--left { left: -6px; }
.cards-arrow--right { right: -6px; }

/* ── 3D 卡片翻转 ── */
.cards-stage { perspective: 1200px; width: 100%; max-width: 440px; margin: auto; }
.card { position: relative; width: 100%; aspect-ratio: 3/2; transition: transform 0.5s; transform-style: preserve-3d; }
.card.flipped { transform: rotateY(180deg); }
.card-face { position: absolute; inset: 0; backface-visibility: hidden; border-radius: 20px; display: flex; align-items: center; justify-content: center; }
.card-front { background: #ffffff; border: 1.5px solid rgba(0,0,0,0.06); box-shadow: 0 4px 32px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04); }
.card-back { background: #faf9fe; border: 1.5px solid rgba(61,53,145,0.08); box-shadow: 0 4px 32px rgba(61,53,145,0.08), 0 1px 4px rgba(0,0,0,0.04); transform: rotateY(180deg); }
.card-content { text-align: center; padding: 32px; }
.card-word { font-size: 52px; font-weight: 600; font-family: 'Lora', serif; letter-spacing: 0.02em; color: #1a1a18; }
.card-flip-btn {
  display: inline-flex; align-items: center; gap: 6px;
  margin-top: 24px; padding: 10px 24px;
  border: 1.5px solid rgba(61,53,145,0.2); border-radius: 10px;
  background: #faf9fe; color: #3d3591;
  font-size: 14px; font-family: 'DM Sans', sans-serif;
  cursor: pointer; transition: all 0.15s;
}
.card-flip-btn:hover { background: #edeafd; border-color: rgba(61,53,145,0.35); }
.card-word-row { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.card-phase { font-size: 11px; padding: 2px 8px; border-radius: 4px; font-family: 'DM Sans', sans-serif; font-weight: 500; flex-shrink: 0; }
.card-phase--learn, .card-phase--lear { background: #fff3cd; color: #856404; }
.card-phase--review { background: #d1ecf1; color: #0c5460; }
.card-phase--mastered { background: #d4edda; color: #155724; }
.card-pronounce-btn { width: 32px; height: 32px; border: 1.5px solid #e0ddd5; border-radius: 50%; background: #fff; color: #3d3591; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.15s; }
.card-pronounce-btn:hover { background: #edeafd; border-color: #3d3591; }
.card-enrich-btn { margin-top: 16px; padding: 6px 16px; border: 1px solid rgba(61,53,145,0.15); border-radius: 8px; background: #faf9fe; color: #3d3591; font-size: 13px; font-family: 'DM Sans', sans-serif; cursor: pointer; transition: all 0.15s; }
.card-enrich-btn:hover { background: #edeafd; border-color: rgba(61,53,145,0.3); }
.card-enrich-btn:disabled { opacity: 0.5; cursor: default; }
.card-phonetic { font-size: 17px; color: #7c77a6; font-family: 'DM Mono', monospace; margin: 10px 0; }
.card-meaning-big { font-size: 28px; color: #1a1a18; margin: 16px 0; font-family: 'DM Sans', sans-serif; font-weight: 500; }
.card-example { font-size: 15px; color: #8a877c; font-style: italic; margin-top: 12px; line-height: 1.5; }
.card-spell-input { width: 80%; padding: 12px; border: 1px solid #e0ddd5; border-radius: 8px; background: #fafaf8; color: #1a1a18; font-size: 18px; text-align: center; outline: none; font-family: 'Lora', serif; }
.card-spell-input:focus { border-color: #3d3591; }
.card-spell-btn { margin-top: 12px; padding: 8px 24px; border: none; border-radius: 8px; background: #3d3591; color: #fff; cursor: pointer; font-size: 14px; }

/* ── 评级按钮 ── */
.cards-rating { position: absolute; bottom: 40px; left: 0; right: 0; display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
.rate-btn { padding: 10px 16px; border: none; border-radius: 10px; cursor: pointer; font-size: 14px; font-family: 'DM Sans', sans-serif; color: #fff; display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 70px; }
.rate-key { font-size: 11px; opacity: 0.5; }
.rate-again { background: #c0392b; }
.rate-hard { background: #e67e22; }
.rate-good { background: #27ae60; }
.rate-easy { background: #2980b9; }
.rate-btn:hover { filter: brightness(1.1); }

.cards-timer { text-align: center; font-size: 24px; color: #c4c1ba; font-family: 'DM Mono', monospace; padding-bottom: 20px; }

@media (max-width: 480px) {
  .cards-stage { max-width: 100%; }
  .card-word { font-size: 40px; }
  .card-meaning-big { font-size: 22px; }
  .rate-btn { padding: 10px 14px; font-size: 13px; min-width: 64px; }
}
</style>
