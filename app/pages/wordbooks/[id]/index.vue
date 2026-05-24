<template>
  <div class="wd-page">
    <header class="wd-header">
      <NuxtLink to="/wordbooks" class="wd-back">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="15 18 9 12 15 6"/></svg>
        书架
      </NuxtLink>
      <h1 class="wd-title">{{ bookName }}</h1>
      <div class="wd-header-right">
        <button class="wd-hdr-btn" @click="goCards">Learn</button>
        <button class="wd-hdr-btn wd-btn-ai" @click="enrichAll" :disabled="batchRunning" title="AI 补全">
          <template v-if="batchRunning"><span class="wd-spin-sm"></span></template>
          <template v-else>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l1.5 6.5L20 10l-6.5 1.5L12 18l-1.5-6.5L4 10l6.5-1.5z"/></svg>
          </template>
        </button>
        <button class="wd-hdr-btn wd-btn-eye" @click="toggleAllDetails" :title="showDetails ? '隐藏释义' : '显示释义'">
          <svg v-if="showDetails" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        </button>
        <button class="wd-hdr-btn wd-btn-add" @click="showAdd = true">+</button>
        <button class="wd-hdr-btn wd-btn-pos" @click="enrichPos" :disabled="posRunning" title="补充词性">
          <template v-if="posRunning"><span class="wd-spin-sm"></span></template>
          <template v-else>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </template>
        </button>
      </div>
    </header>

    <!-- 工具栏 -->
    <div class="wd-toolbar" v-if="selectedIds.length">
      <span>{{ selectedIds.length }} 项</span>
      <button @click="moveSelected">移动到 ⭐ 默认</button>
      <button @click="deleteSelected" class="wd-btn-del">删除</button>
      <button @click="selectedIds = []">取消</button>
    </div>

    <!-- 单词列表卡片区 -->
    <div class="wd-list-card">
      <!-- 词性筛选 -->
      <div class="wd-pos-bar" ref="posBarRef" v-if="bookId !== 'wb_phrases' && bookId !== 'wb_sentences'">
        <div class="wp-indicator" :style="indicatorStyle"></div>
        <button
          v-for="opt in posTabs" :key="opt.key"
          class="wp-chip" :class="{ active: activePos === opt.key }"
          @click="activePos = opt.key"
        >{{ opt.label }}</button>
      </div>
      <div class="wd-pos-stats" v-if="bookId !== 'wb_phrases' && bookId !== 'wb_sentences'">
        <span v-for="(c, i) in posCounts" :key="c.key">
          <template v-if="i > 0"><span class="wps-dot">·</span></template>
          <span :class="{ 'wps-active': activePos === c.key }">{{ c.label }} {{ c.count }}</span>
        </span>
      </div>
      <!-- 单词列表 -->
      <div class="wd-list">
        <div v-if="loading" class="wd-empty">加载中…</div>
        <div v-else-if="!words.length" class="wd-empty">还没有单词，导入 TXT 或手动添加</div>
        <div
          v-for="w in posFilteredWords" :key="w.id"
          class="wd-row"
          :class="{ selected: selectedIds.includes(w.id) }"
          @click="selectedIds.length ? toggleSelect(w.id) : toggleWord(w.id)"
        >
          <div class="wd-check" v-if="selectedIds.length" @click.stop="toggleSelect(w.id)">
            <div class="wd-checkbox" :class="{ on: selectedIds.includes(w.id) }">
              <svg v-if="selectedIds.includes(w.id)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
          </div>
          <div class="wd-row-body">
            <div class="wd-word">{{ w.word }}<span v-if="w.pos" class="wd-pos-badge">{{ w.pos }}</span></div>
            <div class="detail-wrap" :class="{ open: showDetails || expandedWords.has(w.id) }">
              <div class="detail-inner">
                <span class="wd-phonetic">{{ w.phonetic }}</span>
                <span class="wd-meaning">{{ w.meaning }}</span>
              </div>
            </div>
          </div>
          <div class="wd-row-actions">
            <button class="wd-move" @click.stop="openMoveDropdown(w, $event)" title="移动到其他单词本">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>
            <button class="wd-del" @click.stop="deleteWord(w.id)">×</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 移动下拉菜单 -->
    <Teleport to="body">
      <template v-if="moveTarget">
        <div class="move-overlay" @click="moveTarget = ''"></div>
        <div class="move-dropdown" :style="moveDropdownStyle">
          <div class="move-dropdown-header">移动到…</div>
          <div
            v-for="b in moveTargetList" :key="b.id"
            class="move-dropdown-item"
            @click="moveWordToBook(moveTarget, b.id)"
          >{{ b.name }}</div>
          <div v-if="!moveTargetList.length" class="move-dropdown-empty">没有其他单词本</div>
        </div>
      </template>
    </Teleport>

    <!-- 添加单词弹窗 -->
    <Teleport to="body">
      <div v-if="showAdd" class="modal-overlay" @click.self="showAdd = false">
        <div class="modal-card">
          <h3>添加单词</h3>
          <input v-model="addWord" class="modal-input" placeholder="英文单词" @keydown.enter="handleAdd" />
          <div class="modal-actions">
            <button @click="showAdd = false">取消</button>
            <button class="btn-primary" @click="handleAdd" :disabled="!addWord.trim()">添加</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const bookId = route.params.id as string

interface Word { id: string; word: string; phonetic: string; meaning: string; example: string; phase: string; learnCorrect: number; note: string; pos: string }

const words = ref<Word[]>([])
const bookName = ref('')
const loading = ref(true)
const selectedIds = ref<string[]>([])
const expandedWords = ref(new Set<string>())
const showDetails = ref(true)
function toggleAllDetails() {
  showDetails.value = !showDetails.value
  expandedWords.value.clear()
}
function toggleWord(id: string) {
  const w = words.value.find(x => x.id === id)
  if (!w) return
  if (expandedWords.value.has(id)) {
    expandedWords.value.delete(id)
  } else {
    expandedWords.value.add(id)
    pronounceWord(w.word)
  }
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
const showAdd = ref(false)
const addWord = ref('')
const wordbookList = ref<any[]>([])

async function load() {
  loading.value = true
  try {
    const [wList, bList] = await Promise.all([
      $fetch<Word[]>(`/api/wordbooks/${bookId}/words`),
      $fetch<any[]>('/api/wordbooks'),
    ])
    words.value = wList
    bookName.value = bList.find(b => b.id === bookId)?.name || '单词本'
    wordbookList.value = bList
  } catch {}
  loading.value = false
}

function toggleSelect(id: string) {
  const i = selectedIds.value.indexOf(id)
  i >= 0 ? selectedIds.value.splice(i, 1) : selectedIds.value.push(id)
}

async function deleteWord(id: string) {
  await $fetch(`/api/wordbooks/${bookId}/words/${id}`, { method: 'DELETE' })
  words.value = words.value.filter(w => w.id !== id)
}

async function deleteSelected() {
  if (!confirm('删除选中单词？')) return
  for (const id of selectedIds.value) {
    await $fetch(`/api/wordbooks/${bookId}/words/${id}`, { method: 'DELETE' })
  }
  words.value = words.value.filter(w => !selectedIds.value.includes(w.id))
  selectedIds.value = []
}

async function moveSelected() {
  await $fetch(`/api/wordbooks/${bookId}/words/move`, { method: 'POST', body: { wordIds: selectedIds.value.slice(), toBookId: 'wb_default' } })
  words.value = words.value.filter(w => !selectedIds.value.includes(w.id))
  selectedIds.value = []
}


// ── 移动到其他单词本 ──
const moveTarget = ref('')  // 当前打开下拉的单词 id
const moveDropdownPos = ref({ top: 0, left: 0 })

function openMoveDropdown(w: Word, e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  moveDropdownPos.value = {
    top: rect.bottom + 4,
    left: Math.min(rect.left, window.innerWidth - 220),
  }
  moveTarget.value = w.id
}

const moveTargetList = computed(() =>
  wordbookList.value.filter(b => b.id !== bookId && b.id !== 'wb_default')
)

const moveDropdownStyle = computed(() => ({
  top: `${moveDropdownPos.value.top}px`,
  left: `${moveDropdownPos.value.left}px`,
}))

async function moveWordToBook(wordId: string, toBookId: string) {
  moveTarget.value = ''
  await $fetch(`/api/wordbooks/${bookId}/words/move`, {
    method: 'POST',
    body: { wordIds: [wordId], toBookId },
  })
  words.value = words.value.filter(w => w.id !== wordId)
}

async function handleAdd() {
  const w = addWord.value.trim(); if (!w) return
  try {
    const res = await $fetch<{ inserted: number }>(`/api/wordbooks/${bookId}/words/import`, { method: 'POST', body: { words: [w] } })
    if (res.inserted) { showAdd.value = false; addWord.value = ''; load() }
    else alert('单词已存在')
  } catch { alert('添加失败') }
}

function goCards() { window.location.href = `/wordbooks/${bookId}/cards` }

// ── 词性筛选 ──
const posTabs = [
  { key: '', label: '全部' },
  { key: 'n.', label: 'n.名词' },
  { key: 'v.', label: 'v.动词' },
  { key: 'adj.', label: 'adj.形容词' },
  { key: 'adv.', label: 'adv.副词' },
]
const activePos = ref('')
const posFilteredWords = computed(() =>
  activePos.value ? words.value.filter(w => w.pos === activePos.value) : words.value
)

const posCounts = computed(() => {
  const total = words.value.length
  const counts: Record<string, number> = {}
  for (const w of words.value) {
    const p = w.pos || ''
    counts[p] = (counts[p] || 0) + 1
  }
  const labelMap: Record<string, string> = {
    '': '全部',
    'n.': '名词',
    'v.': '动词',
    'adj.': '形容词',
    'adv.': '副词',
  }
  const items: Array<{ key: string; label: string; count: number }> = []
  for (const t of posTabs) {
    const c = t.key === '' ? total : (counts[t.key] || 0)
    if (c > 0) items.push({ key: t.key, label: labelMap[t.key] || t.label, count: c })
  }
  return items
})

// ── 滑块指示器 ──
const posBarRef = ref<HTMLElement | null>(null)
const indicatorStyle = ref({ left: '0px', width: '0px' })

function updateIndicator() {
  const bar = posBarRef.value
  if (!bar) return
  const chips = bar.querySelectorAll<HTMLElement>('.wp-chip')
  const idx = posTabs.findIndex(t => t.key === activePos.value)
  const el = chips[idx]
  if (!el) return
  indicatorStyle.value = {
    left: `${el.offsetLeft}px`,
    width: `${el.offsetWidth}px`,
  }
}

watch(activePos, updateIndicator)
onMounted(updateIndicator)

const posRunning = ref(false)
async function enrichPos() {
  if (posRunning.value) return
  posRunning.value = true
  try {
    await $fetch(`/api/wordbooks/${bookId}/words/enrich-pos`, { method: 'POST' })
  } catch {}
  await load()
  posRunning.value = false
}

const batchRunning = ref(false)
const batchTotal = ref(0)
const batchDone = ref(0)

async function enrichAll() {
  if (batchRunning.value) return
  const targets = words.value.filter(w => !w.meaning?.trim())
  if (!targets.length) return

  batchRunning.value = true
  batchTotal.value = targets.length
  batchDone.value = 0

  try {
    const wordIds = targets.map(w => w.id)
    await $fetch(`/api/wordbooks/${bookId}/words/enrich-batch`, {
      method: 'POST',
      body: { wordIds },
    })
  } catch {}
  await load()
  batchRunning.value = false
}

// 长按多选 (移动端)
let longTimer: any = null
function onTouchStart(w: Word, e: TouchEvent) {
  longTimer = setTimeout(() => { selectedIds.value = [w.id] }, 500)
}
function onTouchEnd() { clearTimeout(longTimer) }

onMounted(load)
</script>

<style scoped>
.wd-page { height: 100vh; display: flex; flex-direction: column; background: #f7f6f3; overflow: hidden; }

.wd-header {
  display: flex; align-items: center;
  padding: 0 20px; height: 50px; background: #fff;
  border-bottom: 0.5px solid rgba(0,0,0,0.08); flex-shrink: 0;
}
.wd-back { display: flex; align-items: center; gap: 4px; font-size: 13px; color: #666; text-decoration: none; font-family: 'DM Sans', sans-serif; white-space: nowrap; flex-shrink: 0; }
.wd-title { flex: 1; text-align: center; font-size: 15px; font-weight: 600; color: #1a1a18; font-family: 'Lora', serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 12px; }
.wd-header-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.wd-hdr-btn { padding: 5px 12px; border: 1px solid #e0ddd5; border-radius: 6px; background: #fff; font-size: 13px; cursor: pointer; font-family: 'DM Sans', sans-serif; color: #666; white-space: nowrap; }
.wd-hdr-btn:hover { border-color: #3d3591; color: #3d3591; }
.wd-btn-add { font-size: 18px; font-weight: 500; padding: 3px 12px; }
.wd-btn-ai { font-size: 15px; padding: 5px 10px; line-height: 1; }
.wd-btn-ai:disabled { opacity: 0.5; }
.wd-btn-eye { padding: 5px 10px; line-height: 1; display: flex; align-items: center; color: #888; }
.wd-btn-eye:hover { color: #3d3591; }
.wd-btn-pos { font-size: 15px; padding: 5px 10px; line-height: 1; display: flex; align-items: center; }
.wd-btn-pos:disabled { opacity: 0.5; }
.wd-spin-sm { display: inline-block; width: 12px; height: 12px; border: 1.5px solid #e0ddd5; border-top-color: #3d3591; border-radius: 50%; animation: wdSpin 0.6s linear infinite; vertical-align: middle; }
@keyframes wdSpin { to { transform: rotate(360deg); } }

.wd-toolbar {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 20px; background: #faf9fe; border-bottom: 1px solid rgba(61,53,145,0.1);
  font-size: 13px; font-family: 'DM Sans', sans-serif; flex-shrink: 0;
}
.wd-toolbar button { padding: 4px 10px; border: 1px solid #e0ddd5; border-radius: 5px; background: #fff; cursor: pointer; font-size: 12px; }
.wd-btn-del { color: #d55 !important; border-color: #fcc !important; }

/* ── 词性筛选条 ── */
.wd-pos-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0;
  padding: 3px 6px 4px;
  background: #f0efe9;
  flex-shrink: 0;
}

.wp-indicator {
  position: absolute;
  top: 3px;
  bottom: 4px;
  background: #ffffff;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  transition: left 0.35s cubic-bezier(0.4, 0, 0.2, 1), width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: none;
  z-index: 0;
}

.wp-chip {
  position: relative;
  z-index: 1;
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  background: transparent;
  font-size: 15px;
  font-weight: 350;
  color: #8a877c;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: color 0.15s;
}
.wp-chip:hover { color: #4a4640; }
.wp-chip.active {
  color: #19191a;
  font-weight: 520;
  font-size: 15px;
}

/* ── 词性计数统计 ── */
.wd-pos-stats {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 20px 6px;
  background: #f0efe9;
  font-size: 12px;
  color: #a09e97;
  font-family: 'DM Sans', sans-serif;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.wps-dot {
  margin: 0 2px;
  color: #c4c1ba;
}
.wps-active {
  color: #3d3591;
  font-weight: 500;
}

.wd-list { flex: 1; overflow-y: auto; }
.wd-empty { text-align: center; color: #aaa; padding: 60px 0; font-size: 14px; }

.wd-list-card { flex: 1; display: flex; flex-direction: column; background: #ffffff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.05); max-width: 680px; margin: 0 auto; width: 100%; overflow: hidden; min-height: 0;margin-top:3px; }

.wd-row {
  display: flex; align-items: flex-start;
  padding: 14px 20px; cursor: pointer;
  border-bottom: 0.5px solid rgba(0,0,0,0.04);
  font-family: 'DM Sans', sans-serif; transition: background 0.1s;
}
.wd-row:hover { background: rgba(0,0,0,0.01); }
.wd-row.selected { background: rgba(61,53,145,0.04); }
.wd-check { flex-shrink: 0; padding-top: 2px; }
.wd-checkbox { width: 20px; height: 20px; border: 1.5px solid #ccc; border-radius: 4px; display: flex; align-items: center; justify-content: center; }
.wd-checkbox.on { background: #3d3591; border-color: #3d3591; }
.wd-row-body { min-width: 0; }
.wd-word { font-size: 17px; font-weight: 600; color: #1a1a18; margin-bottom: 4px; }
.wd-pos-badge { display: inline-block; margin-left: 6px; padding: 1px 6px; font-size: 10px; font-weight: 500; color: #7c77a6; background: #f0eefb; border-radius: 4px; vertical-align: middle; font-family: 'DM Mono', monospace; }
.wd-row-sub { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.wd-phonetic { font-size: 13px; color: #7c77a6; font-family: 'DM Mono', monospace; }
.wd-meaning { font-size: 13px; color: #666; }
.wd-row-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; padding-top: 4px; margin-left: auto; }
.wd-del { border: none; background: none; font-size: 18px; color: #ccc; cursor: pointer; padding: 4px 6px; line-height: 1; }
.wd-del:hover { color: #d55; }
.wd-move { border: none; background: none; cursor: pointer; padding: 4px 6px; line-height: 1; display: flex; align-items: center; color: #ccc; }
.wd-move:hover { color: #3d3591; }

/* ── 折叠动画 ── */
.detail-wrap { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.2s linear; }
.detail-wrap.open { grid-template-rows: 1fr; }
.detail-inner { overflow: hidden; }

/* ── 移动下拉菜单 ── */
.move-overlay { position: fixed; inset: 0; z-index: 900; }
.move-dropdown { position: fixed; z-index: 910; background: #fff; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,0.15); min-width: 160px; max-width: 240px; overflow: hidden; padding: 4px; animation: moveFadeIn 0.12s ease; }
@keyframes moveFadeIn { from { opacity: 0; transform: scale(0.95) translateY(-4px); } to { opacity: 1; transform: scale(1) translateY(0); } }
.move-dropdown-header { padding: 8px 12px; font-size: 11px; color: #aaa; font-family: 'DM Sans', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; }
.move-dropdown-item { padding: 8px 12px; font-size: 13px; color: #333; cursor: pointer; border-radius: 6px; font-family: 'DM Sans', sans-serif; }
.move-dropdown-item:hover { background: #f7f6f3; color: #3d3591; }
.move-dropdown-empty { padding: 12px; font-size: 12px; color: #ccc; text-align: center; }

/* ── 添加弹窗 ── */
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
  .wd-header, .wd-toolbar { padding-left: 14px; padding-right: 14px; }
  .wd-row { padding: 12px 14px; }
}
</style>
