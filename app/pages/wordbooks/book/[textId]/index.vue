<template>
  <div class="wbk-page">
    <header class="wbk-header">
      <NuxtLink to="/wordbooks" class="wbk-back">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="15 18 9 12 15 6"/></svg>
        单词本
      </NuxtLink>
      <h1 class="wbk-title">{{ bookTitle }}</h1>
      <div class="wbk-header-right">
        <button class="wbk-hdr-btn" @click="goCards">学习</button>
        <button class="wbk-hdr-btn wbk-btn-ai" @click="enrichAll" :disabled="batchRunning" title="AI 补全">
          <template v-if="batchRunning"><span class="wbk-spin"></span></template>
          <template v-else>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l1.5 6.5L20 10l-6.5 1.5L12 18l-1.5-6.5L4 10l6.5-1.5z"/></svg>
          </template>
        </button>
        <button class="wbk-hdr-btn wbk-btn-eye" @click="toggleAllDetails" :title="showDetails ? '隐藏释义' : '显示释义'">
          <svg v-if="showDetails" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        </button>
        <button class="wbk-hdr-btn wbk-btn-add" @click="showAdd = true">+</button>
      </div>
    </header>

    <!-- Tab 栏 -->
    <div class="wbk-body">
      <div class="wbk-tabs">
      <button v-for="t in typeTabs" :key="t.key"
        class="wbk-tab" :class="{ active: activeType === t.key }"
        @click="activeType = t.key"
      >{{ t.label }}</button>
    </div>

    <!-- 词性筛选（仅单词 tab） -->
    <template v-if="activeType === 'word'">
      <div class="wbk-pos-bar" ref="posBarRef">
        <div class="wbk-pos-indicator" :style="indicatorStyle"></div>
        <button v-for="opt in posTabs" :key="opt.key"
          class="wbk-pos-chip" :class="{ active: activePos === opt.key }"
          @click="activePos = opt.key"
        >{{ opt.label }}</button>
      </div>
      <div class="wbk-pos-stats">
        <span v-for="(c, i) in posCounts" :key="c.key">
          <template v-if="i > 0"><span class="wbk-stats-dot">·</span></template>
          <span :class="{ 'wbk-stats-active': activePos === c.key }">{{ c.label }} {{ c.count }}</span>
        </span>
      </div>
    </template>

    <!-- 单词列表 -->
    <div class="wbk-card">
      <div class="wbk-list">
        <div v-if="loading" class="wbk-empty">加载中…</div>
        <div v-else-if="!displayWords.length" class="wbk-empty">还没有{{ typeLabel }}，阅读时标记即可添加</div>
        <div v-for="w in displayWords" :key="w.id"
          class="wbk-row"
          :class="{ selected: selectedIds.includes(w.id) }"
          @click="selectedIds.length ? toggleSelect(w.id) : toggleWord(w.id)"
        >
          <div v-if="selectedIds.length" class="wbk-check" @click.stop="toggleSelect(w.id)">
            <div class="wbk-checkbox" :class="{ on: selectedIds.includes(w.id) }">
              <svg v-if="selectedIds.includes(w.id)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
          </div>
          <div class="wbk-row-body">
            <div class="wbk-word">{{ w.word }}<span v-if="w.pos" class="wbk-pos-badge">{{ w.pos }}</span></div>
            <div class="wbk-detail-wrap" :class="{ open: showDetails }">
              <div class="wbk-detail-inner">
                <span class="wbk-phonetic">{{ w.phonetic }}</span>
                <span class="wbk-meaning">{{ w.meaning }}</span>
              </div>
            </div>
          </div>
          <div class="wbk-row-actions">
            <button class="wbk-move" @click.stop="openMoveDropdown(w, $event)" title="移动">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>
            <button class="wbk-del" @click.stop="deleteWord(w.id)">×</button>
          </div>
        </div>
      </div>
    </div>
    </div>

    <!-- 移动下拉 -->
    <Teleport to="body">
      <template v-if="moveTarget">
        <div class="move-overlay" @click="moveTarget = ''"></div>
        <div class="move-dropdown" :style="moveDropdownStyle">
          <div class="move-dropdown-header">移动到…</div>
          <div v-for="b in otherBooks" :key="b.id" class="move-dropdown-item" @click="moveWord(moveTarget, b.id)">{{ b.name }}</div>
          <div v-if="!otherBooks.length" class="move-dropdown-empty">没有其他单词本</div>
        </div>
      </template>
    </Teleport>

    <!-- 添加弹窗 -->
    <Teleport to="body">
      <div v-if="showAdd" class="modal-overlay" @click.self="showAdd = false">
        <div class="modal-card">
          <h3>添加{{ typeLabel }}</h3>
          <input v-model="addText" class="modal-input" :placeholder="'英文' + typeLabel" @keydown.enter="handleAdd" />
          <div class="modal-actions">
            <button @click="showAdd = false">取消</button>
            <button class="btn-primary" @click="handleAdd" :disabled="!addText.trim()">添加</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const textId = route.params.textId as string

interface WordItem { id: string; word: string; phonetic: string; meaning: string; pos: string; note: string }

const words = ref<WordItem[]>([])
const bookTitle = ref('')
const loading = ref(true)

// ── 类型 Tab ──
const typeTabs = [
  { key: 'word', label: '单词' },
  { key: 'phrase', label: '短语' },
  { key: 'sentence', label: '句子' },
]
const activeType = ref('word')
const typeLabel = computed(() => typeTabs.find(t => t.key === activeType.value)?.label || '')

// ── 词性筛选（仅单词） ──
const posTabs = [
  { key: '', label: '全部' },
  { key: 'n.', label: 'n.名词' },
  { key: 'v.', label: 'v.动词' },
  { key: 'adj.', label: 'adj.形容词' },
  { key: 'adv.', label: 'adv.副词' },
]
const activePos = ref('')

const posCounts = computed(() => {
  const total = words.value.length
  const counts: Record<string, number> = {}
  for (const w of words.value) {
    const p = w.pos || ''
    counts[p] = (counts[p] || 0) + 1
  }
  const labelMap: Record<string, string> = {
    '': '全部', 'n.': '名词', 'v.': '动词', 'adj.': '形容词', 'adv.': '副词',
  }
  const items: Array<{ key: string; label: string; count: number }> = []
  for (const t of posTabs) {
    const c = t.key === '' ? total : (counts[t.key] || 0)
    if (c > 0) items.push({ key: t.key, label: labelMap[t.key] || t.label, count: c })
  }
  return items
})

const posFilteredWords = computed(() =>
  activePos.value ? words.value.filter(w => w.pos === activePos.value) : words.value
)

const displayWords = computed(() =>
  activeType.value === 'word' ? posFilteredWords.value : words.value
)

// ── 滑块指示器 ──
const posBarRef = ref<HTMLElement | null>(null)
const indicatorStyle = ref({ left: '0px', width: '0px' })

function updateIndicator() {
  const bar = posBarRef.value
  if (!bar) return
  const chips = bar.querySelectorAll<HTMLElement>('.wbk-pos-chip')
  const idx = posTabs.findIndex(t => t.key === activePos.value)
  const el = chips[idx] as HTMLElement | undefined
  if (!el) return
  indicatorStyle.value = {
    left: `${el.offsetLeft}px`,
    width: `${el.offsetWidth}px`,
  }
}

watch(activePos, updateIndicator)

// ── 数据加载 ──
async function loadWords() {
  loading.value = true
  try {
    const [wList, info] = await Promise.all([
      $fetch<WordItem[]>(`/api/wordbooks/book/${textId}/words?type=${activeType.value}`),
      textId === '__orphan__' ? Promise.resolve({ title: '其他' }) : $fetch<any>(`/api/text/${textId}`).catch(() => null),
    ])
    words.value = wList
    bookTitle.value = info?.title || '加载中…'
  } catch { bookTitle.value = '加载失败' }
  loading.value = false
}

watch(activeType, () => { activePos.value = ''; loadWords() })

// ── 显示控制 ──
const showDetails = ref(true)
const selectedIds = ref<string[]>([])

function toggleAllDetails() { showDetails.value = !showDetails.value }

function toggleWord(id: string) {
  const w = words.value.find(x => x.id === id)
  if (!w) return
  pronounceWord(w.word)
}

function pronounceWord(word: string) {
  const w = word.replace(/[^a-zA-Z]/g, '').toLowerCase()
  if (!w) return
  const audio = new Audio(`https://audio.beingfine.cn/speeches/UK/UK-speech/${w}.mp3`)
  audio.play().catch(() => {
    const u = new SpeechSynthesisUtterance(word)
    u.lang = 'en-GB'; u.rate = 0.85
    speechSynthesis.speak(u)
  })
}

function toggleSelect(id: string) {
  const i = selectedIds.value.indexOf(id)
  i >= 0 ? selectedIds.value.splice(i, 1) : selectedIds.value.push(id)
}

// ── 操作 ──
const currentBookId = computed(() =>
  ({ word: 'wb_default', phrase: 'wb_phrases', sentence: 'wb_sentences' })[activeType.value]
)

async function deleteWord(id: string) {
  await $fetch(`/api/wordbooks/${currentBookId.value}/words/${id}`, { method: 'DELETE' })
  words.value = words.value.filter(w => w.id !== id)
}

const showAdd = ref(false)
const addText = ref('')

async function handleAdd() {
  const t = addText.value.trim()
  if (!t) return
  try {
    await $fetch(`/api/wordbooks/${currentBookId.value}/words/import`, {
      method: 'POST', body: { words: [t], source: textId },
    })
    showAdd.value = false; addText.value = ''; loadWords()
  } catch { alert('添加失败') }
}

function goCards() { /* could link to cards for this type */ }

const batchRunning = ref(false)
async function enrichAll() {
  const targets = words.value.filter(w => !w.meaning?.trim())
  if (!targets.length) return
  batchRunning.value = true
  try {
    await $fetch(`/api/wordbooks/${currentBookId.value}/words/enrich-batch`, {
      method: 'POST', body: { wordIds: targets.map(w => w.id) },
    })
  } catch {}
  await loadWords()
  batchRunning.value = false
}

// ── 移动 ──
const moveTarget = ref('')
const moveDropdownPos = ref({ top: 0, left: 0 })

async function openMoveDropdown(w: WordItem, e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  moveDropdownPos.value = {
    top: rect.bottom + 4,
    left: Math.min(rect.left, window.innerWidth - 220),
  }
  try { wordbookList.value = await $fetch('/api/wordbooks') } catch {}
  moveTarget.value = w.id
}

const wordbookList = ref<any[]>([])
const otherBooks = computed(() => wordbookList.value.filter(b => b.id !== currentBookId.value))

const moveDropdownStyle = computed(() => ({
  top: `${moveDropdownPos.value.top}px`,
  left: `${moveDropdownPos.value.left}px`,
}))

async function moveWord(wordId: string, toBookId: string) {
  moveTarget.value = ''
  await $fetch(`/api/wordbooks/${currentBookId.value}/words/move`, {
    method: 'POST', body: { wordIds: [wordId], toBookId },
  })
  words.value = words.value.filter(w => w.id !== wordId)
}

onMounted(async () => {
  await loadWords()
  nextTick(updateIndicator)
  try { wordbookList.value = await $fetch('/api/wordbooks') } catch {}
})
</script>

<style scoped>
.wbk-page { height: 100vh; display: flex; flex-direction: column; background: #f7f6f3; overflow: hidden; }

/* ── Header ── */
.wbk-header {
  display: flex; align-items: center;
  padding: 0 20px; height: 50px; background: #fff;
  border-bottom: 0.5px solid rgba(0,0,0,0.08); flex-shrink: 0;
}
.wbk-back { display: flex; align-items: center; gap: 4px; font-size: 13px; color: #666; text-decoration: none; font-family: 'DM Sans', sans-serif; white-space: nowrap; flex-shrink: 0; }
.wbk-title { flex: 1; text-align: center; font-size: 15px; font-weight: 600; color: #1a1a18; font-family: 'Lora', serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 12px; }
.wbk-header-right { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.wbk-hdr-btn { padding: 4px 10px; border: 1px solid #e0ddd5; border-radius: 6px; background: #fff; font-size: 13px; cursor: pointer; font-family: 'DM Sans', sans-serif; color: #666; white-space: nowrap; display: flex; align-items: center; line-height: 1; }
.wbk-hdr-btn:hover { border-color: #3d3591; color: #3d3591; }
.wbk-btn-add { font-size: 18px; font-weight: 500; padding: 3px 10px; }
.wbk-btn-ai:disabled { opacity: 0.5; }
.wbk-spin { display: inline-block; width: 12px; height: 12px; border: 1.5px solid #e0ddd5; border-top-color: #3d3591; border-radius: 50%; animation: wbkSpin 0.6s linear infinite; }
@keyframes wbkSpin { to { transform: rotate(360deg); } }

/* ── Main body (constrained width) ── */
.wbk-body {
  flex: 1; overflow-y: auto;
  display: flex; flex-direction: column;
  max-width: 680px; width: 100%; margin: 0 auto;
}

/* ── Tabs ── */
.wbk-tabs {
  display: flex; gap: 0; flex-shrink: 0;
  padding: 6px 20px 0;
  background: #fff;
  border-bottom: 0.5px solid rgba(0,0,0,0.04);
}
.wbk-tab {
  padding: 6px 16px; border: none; background: transparent;
  font-size: 13px; font-weight: 450; color: #8a877c;
  cursor: pointer; font-family: inherit; white-space: nowrap;
  border-bottom: 2px solid transparent; margin-bottom: -0.5px;
  transition: all 0.15s;
}
.wbk-tab:hover { color: #4a4640; }
.wbk-tab.active { color: #3d3591; border-bottom-color: #3d3591; font-weight: 500; }

/* ── Pos Bar ── */
.wbk-pos-bar {
  position: relative; display: flex; align-items: center; gap: 0;
  padding: 3px 20px 4px; background: #f0efe9; flex-shrink: 0;
}
.wbk-pos-indicator {
  position: absolute; top: 3px; bottom: 4px;
  background: #ffffff; border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  transition: left 0.35s cubic-bezier(0.4, 0, 0.2, 1), width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: none; z-index: 0;
}
.wbk-pos-chip {
  position: relative; z-index: 1;
  padding: 6px 14px; border-radius: 8px; border: none;
  background: transparent; font-size: 13px; font-weight: 450;
  color: #8a877c; cursor: pointer; font-family: inherit;
  white-space: nowrap; transition: color 0.15s;
}
.wbk-pos-chip:hover { color: #4a4640; }
.wbk-pos-chip.active { color: #3d3591; font-weight: 600; font-size: 14px; }

/* ── Pos Stats ── */
.wbk-pos-stats {
  display: flex; align-items: center; gap: 6px;
  padding: 2px 20px 6px; background: #f0efe9;
  font-size: 12px; color: #a09e97; font-family: 'DM Sans', sans-serif;
  flex-shrink: 0; flex-wrap: wrap;
}
.wbk-stats-dot { margin: 0 2px; color: #c4c1ba; }
.wbk-stats-active { color: #3d3591; font-weight: 500; }

/* ── Card + List ── */
.wbk-card { flex: 1; display: flex; flex-direction: column; background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.05); max-width: 680px; margin: 3px auto 0; width: 100%; overflow: hidden; min-height: 0; }
.wbk-list { flex: 1; overflow-y: auto; }
.wbk-empty { text-align: center; color: #aaa; padding: 60px 0; font-size: 14px; font-family: 'DM Sans', sans-serif; }

.wbk-row {
  display: flex; align-items: flex-start;
  padding: 14px 20px; cursor: pointer;
  border-bottom: 0.5px solid rgba(0,0,0,0.04);
  font-family: 'DM Sans', sans-serif; transition: background 0.1s;
}
.wbk-row:hover { background: rgba(0,0,0,0.01); }
.wbk-row.selected { background: rgba(61,53,145,0.04); }
.wbk-check { flex-shrink: 0; padding-top: 2px; }
.wbk-checkbox { width: 20px; height: 20px; border: 1.5px solid #ccc; border-radius: 4px; display: flex; align-items: center; justify-content: center; }
.wbk-checkbox.on { background: #3d3591; border-color: #3d3591; }
.wbk-row-body { min-width: 0; }
.wbk-word { font-size: 17px; font-weight: 600; color: #1a1a18; margin-bottom: 4px; }
.wbk-pos-badge { display: inline-block; margin-left: 6px; padding: 1px 6px; font-size: 10px; font-weight: 500; color: #7c77a6; background: #f0eefb; border-radius: 4px; vertical-align: middle; font-family: 'DM Mono', monospace; }
.wbk-phonetic { font-size: 13px; color: #7c77a6; font-family: 'DM Mono', monospace; }
.wbk-meaning { font-size: 13px; color: #666; }
.wbk-row-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; padding-top: 4px; margin-left: auto; }
.wbk-del { border: none; background: none; font-size: 18px; color: #ccc; cursor: pointer; padding: 4px 6px; line-height: 1; }
.wbk-del:hover { color: #d55; }
.wbk-move { border: none; background: none; cursor: pointer; padding: 4px 6px; line-height: 1; display: flex; align-items: center; color: #ccc; }
.wbk-move:hover { color: #3d3591; }

/* ── 折叠动画 ── */
.wbk-detail-wrap { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.2s linear; }
.wbk-detail-wrap.open { grid-template-rows: 1fr; }
.wbk-detail-inner { overflow: hidden; }

/* ── 移动下拉 ── */
.move-overlay { position: fixed; inset: 0; z-index: 900; }
.move-dropdown { position: fixed; z-index: 910; background: #fff; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,0.15); min-width: 160px; max-width: 240px; overflow: hidden; padding: 4px; animation: moveFadeIn 0.12s ease; }
@keyframes moveFadeIn { from { opacity: 0; transform: scale(0.95) translateY(-4px); } to { opacity: 1; transform: scale(1) translateY(0); } }
.move-dropdown-header { padding: 8px 12px; font-size: 11px; color: #aaa; font-family: 'DM Sans', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; }
.move-dropdown-item { padding: 8px 12px; font-size: 13px; color: #333; cursor: pointer; border-radius: 6px; font-family: 'DM Sans', sans-serif; }
.move-dropdown-item:hover { background: #f7f6f3; color: #3d3591; }
.move-dropdown-empty { padding: 12px; font-size: 12px; color: #ccc; text-align: center; }

/* ── Modal ── */
.modal-overlay { position: fixed; inset: 0; z-index: 1100; background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; }
.modal-card { background: #fff; border-radius: 12px; padding: 24px; width: 90%; max-width: 360px; }
.modal-card h3 { font-size: 16px; font-weight: 600; margin-bottom: 16px; font-family: 'DM Sans', sans-serif; }
.modal-input { width: 100%; padding: 10px 14px; border: 1px solid #e0ddd5; border-radius: 8px; font-size: 15px; font-family: 'DM Sans', sans-serif; outline: none; }
.modal-input:focus { border-color: #3d3591; }
.modal-actions { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }
.modal-actions button { padding: 8px 18px; border: 1px solid #e0ddd5; border-radius: 8px; background: #fff; cursor: pointer; font-size: 14px; }
.modal-actions .btn-primary { background: #3d3591; color: #fff; border: none; }
.modal-actions .btn-primary:disabled { opacity: 0.4; }

@media (max-width: 480px) {
  .wbk-header { padding: 0 14px; }
  .wbk-row { padding: 12px 14px; }
}
</style>
