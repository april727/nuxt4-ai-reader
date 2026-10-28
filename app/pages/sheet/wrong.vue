<template>
  <div class="wrong-page">
    <PageHeader title="错题本" active="reviews" back-to="/" back-label="书架" />

    <div class="wp-meta">
      <div class="wp-filters">
        <button class="wp-chip" :class="{ on: !dueOnly }" @click="setScope(false)">全部 {{ stats.total }}</button>
        <button class="wp-chip" :class="{ on: dueOnly }" @click="setScope(true)">
          今日到期 <span class="n">{{ stats.due }}</span>
        </button>
        <span class="wp-spacer"></span>
        <span class="wp-sub">已掌握 {{ stats.mastered }} · 学习中 {{ stats.learning }}</span>
        <button class="wp-reload" :disabled="loading" @click="load()">{{ loading ? '加载中' : '刷新' }}</button>
      </div>
    </div>

    <div class="wp-scroll">
      <div v-if="error" class="wp-empty wp-error">{{ error }}</div>

      <div v-else-if="!items.length" class="wp-empty">
        <p class="wp-empty-title">{{ dueOnly ? '今天没有要复习的错题' : '还没有错题' }}</p>
        <p class="wp-empty-hint">
          在试卷里切到「框选」，把做错的题框出来存为<strong>错题</strong>，它就会出现在这里按间隔重复复习。
        </p>
      </div>

      <div v-else class="wp-grid">
      <article
        v-for="it in items"
        :key="it.id"
        class="wp-card"
        :class="{ mastered: it.phase === 'mastered' }"
        @click="open(it)"
      >
        <div class="wp-thumb" :style="thumbStyle(it)">
          <span v-if="!it.bbox.w" class="wp-thumb-fallback">第 {{ it.pageIndex + 1 }} 页</span>
        </div>
        <div class="wp-card-body">
          <div class="wp-card-top">
            <span class="wp-card-title" :title="it.sheetTitle">{{ it.sheetTitle }}</span>
            <span class="wp-page">P{{ it.pageIndex + 1 }}</span>
          </div>
          <div class="wp-note">{{ it.note || '（无备注）' }}</div>
          <div class="wp-card-foot">
            <span class="wp-due" :class="dueClass(it)">{{ dueText(it) }}</span>
            <span v-if="it.reviewCount" class="wp-reps">复习 {{ it.reviewCount }} 次</span>
            <span v-if="it.lapses >= 2" class="wp-lapse">错过 {{ it.lapses }}</span>
          </div>
        </div>
      </article>
      </div>
    </div>

    <!-- 复习浮层：整页 + 框出该题，先想再看答案 -->
    <div v-if="active" class="wp-modal" @click.self="close">
      <div class="wp-sheet">
        <div class="wp-sheet-head">
          <span class="wp-sheet-title">{{ active.sheetTitle }} · 第 {{ active.pageIndex + 1 }} 页</span>
          <NuxtLink class="wp-open" :to="openLink(active)" target="_blank">在试卷里打开</NuxtLink>
          <button class="wp-x" @click="close">×</button>
        </div>
        <div class="wp-sheet-stage">
          <img :src="active.pageUrl" class="wp-sheet-img" alt="" />
          <div class="wp-sheet-box" :style="boxStyle(active.bbox)"></div>
        </div>
        <div class="wp-sheet-foot">
          <div class="wp-sheet-note">{{ active.note || '（无备注）' }}</div>
          <div class="wp-grades">
            <button class="wp-grade again" @click="grade('again')">忘了</button>
            <button class="wp-grade hard" @click="grade('hard')">勉强</button>
            <button class="wp-grade good" @click="grade('good')">会了</button>
            <button class="wp-grade easy" @click="grade('easy')">很熟</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

interface WrongItem {
  id: string
  sheetId: string
  sheetTitle: string
  folder: string
  pageId: string
  pageIndex: number
  pageUrl: string
  pageW: number
  pageH: number
  bbox: { x: number; y: number; w: number; h: number }
  note: string
  phase: string
  interval: number
  dueAt: string
  reviewCount: number
  lapses: number
  createdAt: string
}

const items = ref<WrongItem[]>([])
const stats = ref({ due: 0, total: 0, mastered: 0, learning: 0 })
const dueOnly = ref(true)
const loading = ref(false)
const error = ref('')
const active = ref<WrongItem | null>(null)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const r = await $fetch<{ items: WrongItem[]; stats: typeof stats.value }>('/api/sheet/wrong/list', {
      query: { due: dueOnly.value ? 1 : 0 },
    })
    items.value = r.items || []
    stats.value = r.stats || { due: 0, total: 0, mastered: 0, learning: 0 }
  } catch (e: any) {
    error.value = e?.data?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function setScope(v: boolean) {
  if (dueOnly.value === v) return
  dueOnly.value = v
  close()
  void load()
}

onMounted(load)

/** 裁剪缩略图：把原图放大到「框刚好铺满容器」，用百分比定位把框对准 */
function thumbStyle(it: WrongItem) {
  const { x, y, w, h } = it.bbox
  const ratio = it.pageW && it.pageH ? (w * it.pageW) / (h * it.pageH) : 2.2
  const base: Record<string, string> = {
    aspectRatio: Number.isFinite(ratio) && ratio > 0 ? String(ratio) : '2.2',
  }
  if (!w || !h || !it.pageUrl) return base
  return {
    ...base,
    backgroundImage: `url("${it.pageUrl}")`,
    backgroundSize: `${100 / w}% ${100 / h}%`,
    backgroundPosition: `${w >= 0.999 ? 0 : (x / (1 - w)) * 100}% ${h >= 0.999 ? 0 : (y / (1 - h)) * 100}%`,
    backgroundRepeat: 'no-repeat',
  }
}

function boxStyle(b: WrongItem['bbox']) {
  return {
    left: `${b.x * 100}%`,
    top: `${b.y * 100}%`,
    width: `${b.w * 100}%`,
    height: `${b.h * 100}%`,
  }
}

function openLink(it: WrongItem) {
  const q = new URLSearchParams({ folder: it.folder || 'default', page: it.pageId, box: it.id })
  return `/sheet/${it.sheetId}?${q.toString()}`
}

function open(it: WrongItem) {
  active.value = it
}

function close() {
  active.value = null
}

function dueText(it: WrongItem) {
  if (it.phase === 'mastered') return '已掌握'
  if (!it.dueAt) return '待复习'
  const diff = Date.now() - Date.parse(it.dueAt)
  if (diff >= 0) {
    const days = Math.floor(diff / 86400000)
    return days >= 1 ? `逾期 ${days} 天` : '今天到期'
  }
  const days = Math.ceil(-diff / 86400000)
  return days <= 1 ? '明天' : `${days} 天后`
}

function dueClass(it: WrongItem) {
  if (it.phase === 'mastered') return 'is-mastered'
  if (!it.dueAt) return 'is-due'
  return Date.parse(it.dueAt) <= Date.now() ? 'is-due' : 'is-future'
}

const grading = ref(false)
async function grade(g: 'again' | 'hard' | 'good' | 'easy') {  const cur = active.value
  if (!cur || grading.value) return
  grading.value = true
  try {
    await $fetch('/api/sheet/wrong/grade', { method: 'POST', body: { id: cur.id, grade: g } })
    // 本地摘掉这张，避免整页重拉导致的列表跳动
    items.value = items.value.filter(x => x.id !== cur.id)
    active.value = null
    stats.value = { ...stats.value, due: Math.max(0, stats.value.due - (dueOnly.value ? 1 : 0)) }
    if (dueOnly.value && !items.value.length) await load()
  } catch (e: any) {
    error.value = e?.data?.message || '评分失败'
  } finally {
    grading.value = false
  }
}
</script>

<style scoped>
.wrong-page {
  height: 100vh; display: flex; flex-direction: column; overflow: hidden;
  background: #f7f6f3; color: #1a1a18;
  font-family: 'DM Sans', sans-serif;
}
/* 全局 body 锁死了文档滚动（阅读页需要），所以列表页自己当滚动容器 */
.wp-scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.wp-meta { padding: 14px 22px 8px; flex-shrink: 0; }
.wp-filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wp-chip {
  border: 0.5px solid rgba(0, 0, 0, 0.12); background: #fff; cursor: pointer;
  border-radius: 20px; padding: 5px 12px; font-size: 12px; color: #6b6862;
  font-family: inherit;
}
.wp-chip.on { background: #edeafd; border-color: rgba(61, 53, 145, 0.25); color: #3d3591; }
.wp-chip .n { color: #a32d2d; font-variant-numeric: tabular-nums; }
.wp-spacer { flex: 1; }
.wp-sub { font-size: 11.5px; color: #a09e97; }
.wp-reload {
  border: 0.5px solid rgba(0, 0, 0, 0.12); background: #fff; cursor: pointer;
  border-radius: 7px; padding: 4px 10px; font-size: 11.5px; color: #6b6862; font-family: inherit;
}
.wp-reload:disabled { opacity: 0.5; cursor: default; }

.wp-grid {
  display: grid; gap: 14px; padding: 8px 22px 40px;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
}
.wp-card {
  background: #fff; border: 0.5px solid rgba(0, 0, 0, 0.1); border-radius: 11px;
  overflow: hidden; cursor: pointer; transition: box-shadow 0.14s, transform 0.14s;
}
.wp-card:hover { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08); transform: translateY(-1px); }
.wp-card.mastered { opacity: 0.72; }
.wp-thumb {
  width: 100%; background-color: #f0eee8; background-clip: padding-box;
  border-bottom: 0.5px solid rgba(0, 0, 0, 0.06);
  display: flex; align-items: center; justify-content: center;
}
.wp-thumb-fallback { font-size: 12px; color: #a09e97; }
.wp-card-body { padding: 9px 11px 11px; }
.wp-card-top { display: flex; align-items: baseline; gap: 6px; }
.wp-card-title {
  font-size: 12.5px; font-weight: 500; flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wp-page { font-size: 10.5px; color: #a09e97; font-family: 'DM Mono', monospace; }
.wp-note {
  font-size: 11.5px; color: #6b6862; margin-top: 3px; line-height: 1.45;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.wp-card-foot { display: flex; align-items: center; gap: 8px; margin-top: 7px; font-size: 10.5px; }
.wp-due { color: #a09e97; }
.wp-due.is-due { color: #a32d2d; }
.wp-due.is-mastered { color: #0f6e56; }
.wp-reps, .wp-lapse { color: #b4b2a9; }
.wp-lapse { color: #ba7517; }

.wp-empty { padding: 60px 22px; text-align: center; }
.wp-empty-title { font-size: 14px; color: #4a4843; }
.wp-empty-hint { font-size: 12px; color: #a09e97; margin-top: 6px; line-height: 1.6; }
.wp-error { color: #a32d2d; font-size: 12.5px; }

.wp-modal {
  position: fixed; inset: 0; background: rgba(26, 26, 24, 0.55);
  display: flex; align-items: center; justify-content: center; z-index: 80; padding: 24px;
}
.wp-sheet {
  background: #fff; border-radius: 13px; overflow: hidden;
  width: min(860px, 94vw); max-height: 92vh; display: flex; flex-direction: column;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.3);
}
.wp-sheet-head {
  display: flex; align-items: center; gap: 10px; padding: 10px 14px;
  border-bottom: 0.5px solid rgba(0, 0, 0, 0.08); flex-shrink: 0;
}
.wp-sheet-title { font-size: 12.5px; font-weight: 500; flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-open { font-size: 11.5px; color: #3d3591; text-decoration: none; }
.wp-open:hover { text-decoration: underline; }
.wp-x { border: none; background: transparent; font-size: 17px; color: #b4b2a9; cursor: pointer; line-height: 1; }
.wp-x:hover { color: #a32d2d; }
.wp-sheet-stage {
  position: relative; flex: 1; overflow: auto; background: #e9e7e1;
  display: flex; align-items: flex-start; justify-content: center; padding: 12px;
}
.wp-sheet-img { max-width: 100%; display: block; background: #fff; }
.wp-sheet-box {
  position: absolute; border: 2px solid #a32d2d; background: rgba(163, 45, 45, 0.08);
  border-radius: 3px; pointer-events: none;
}
.wp-sheet-foot {
  display: flex; align-items: center; gap: 12px; padding: 10px 14px;
  border-top: 0.5px solid rgba(0, 0, 0, 0.08); flex-shrink: 0; flex-wrap: wrap;
}
.wp-sheet-note { flex: 1; min-width: 120px; font-size: 12px; color: #6b6862; }
.wp-grades { display: flex; gap: 6px; }
.wp-grade {
  border: 0.5px solid rgba(0, 0, 0, 0.14); background: #fff; cursor: pointer;
  border-radius: 8px; padding: 6px 14px; font-size: 12px; font-family: inherit;
}
.wp-grade.again:hover { border-color: #a32d2d; color: #a32d2d; }
.wp-grade.hard:hover { border-color: #ba7517; color: #ba7517; }
.wp-grade.good:hover { border-color: #3d3591; color: #3d3591; }
.wp-grade.easy:hover { border-color: #0f6e56; color: #0f6e56; }

@media (max-width: 640px) {
  .wp-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); padding: 8px 12px 30px; }
  .wp-meta { padding: 12px 12px 6px; }
}
</style>
