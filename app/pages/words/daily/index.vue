<template>
  <div class="daily-page">
    <PageHeader title="每日学习" active="daily" back-to="/" back-label="书架" />

    <div class="dl-body">
      <div v-if="loading" class="dl-loading">加载中…</div>

      <template v-else-if="calendarMonths.length">
      <!-- 月份切换 -->
      <div class="dl-month-nav">
        <button class="dl-mn-btn" @click="prevMonth" :disabled="monthIdx <= 0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h2 class="dl-month-label">{{ currentMonth.label }}</h2>
        <button class="dl-mn-btn" @click="nextMonth" :disabled="monthIdx >= calendarMonths.length - 1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      <!-- 图例 -->
      <div class="dl-legend">
        <span class="dl-lg"><i class="dl-lg-dot" style="background:#f59e0b"></i>词</span>
        <span class="dl-lg"><i class="dl-lg-dot" style="background:#10b981"></i>短语</span>
        <span class="dl-lg"><i class="dl-lg-dot" style="background:#06b6d4"></i>句</span>
      </div>

      <!-- 日历格子 -->
      <div class="dl-weekdays">
        <span v-for="d in weekDays" :key="d" class="dl-wd">{{ d }}</span>
      </div>
      <div class="dl-grid">
        <div
          v-for="cell in currentMonth.cells" :key="cell.key"
          class="dl-cell"
          :class="{
            empty: !cell.day,
            today: cell.date === todayStr,
            'has-data': cell.day && cell.total > 0,
          }"
          @click="cell.date && cell.total > 0 && goDay(cell.date)"
        >
          <template v-if="cell.day">
            <span class="dl-cell-date">{{ cell.day }}</span>
            <span v-if="cell.total > 0" class="dl-cell-count">{{ cell.word }}</span>
            <span v-if="cell.total > 0" class="dl-cell-dots">
              <i v-if="cell.word" class="dl-dot" style="background:#f59e0b"></i>
              <i v-if="cell.phrase" class="dl-dot" style="background:#10b981"></i>
              <i v-if="cell.sentence" class="dl-dot" style="background:#06b6d4"></i>
            </span>
          </template>
        </div>
      </div>
    </template>

      <div v-else class="dl-empty">暂无学习记录</div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface DayStats {
  date: string; word: number; phrase: number; sentence: number; total: number; textCount: number
}
interface CalCell {
  key: string; day: number | null; date: string | null
  total: number; word: number; phrase: number; sentence: number
}
interface CalMonth {
  key: string; label: string; cells: CalCell[]
}

const days = ref<DayStats[]>([])
const loading = ref(true)
const monthIdx = ref(0)
const weekDays = ['一', '二', '三', '四', '五', '六', '日']
const todayStr = new Date().toISOString().slice(0, 10)

const calendarMonths = computed<CalMonth[]>(() => {
  const dayMap = new Map<string, DayStats>()
  for (const d of days.value) dayMap.set(d.date, d)
  const dates = days.value.map(d => d.date).sort()
  if (!dates.length) return []

  const first = new Date(dates[0])
  first.setDate(1)
  const last = new Date(dates[dates.length - 1])
  last.setMonth(last.getMonth() + 1, 0)

  const now = new Date()
  if (last < now) last.setTime(now.getTime())
  if (first > now) first.setTime(new Date(now.getFullYear(), now.getMonth(), 1).getTime())

  const months: CalMonth[] = []
  const cursor = new Date(first)
  while (cursor <= last) {
    const y = cursor.getFullYear()
    const m = cursor.getMonth()
    const cells: CalCell[] = []
    const monthStart = new Date(y, m, 1)
    const monthEnd = new Date(y, m + 1, 0)
    let startDow = monthStart.getDay()
    if (startDow === 0) startDow = 7
    for (let i = 1; i < startDow; i++) {
      cells.push({ key: `e-${y}-${m}-${i}`, day: null, date: null, total: 0, word: 0, phrase: 0, sentence: 0 })
    }
    for (let d = 1; d <= monthEnd.getDate(); d++) {
      const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const data = dayMap.get(dateStr)
      cells.push({ key: dateStr, day: d, date: dateStr, total: data?.total || 0, word: data?.word || 0, phrase: data?.phrase || 0, sentence: data?.sentence || 0 })
    }
    months.push({ key: `${y}-${m}`, label: `${y}年${m + 1}月`, cells })
    cursor.setMonth(cursor.getMonth() + 1)
  }

  const nowKey = `${now.getFullYear()}-${now.getMonth()}`
  const idx = months.findIndex(m => m.key === nowKey)
  if (idx >= 0) monthIdx.value = idx
  else monthIdx.value = months.length - 1

  return months
})

const currentMonth = computed(() => calendarMonths.value[monthIdx.value] || calendarMonths.value[0])

function prevMonth() { if (monthIdx.value > 0) monthIdx.value-- }
function nextMonth() { if (monthIdx.value < calendarMonths.value.length - 1) monthIdx.value++ }

function goDay(date: string) {
  navigateTo(`/words/daily/${date}`)
}

onMounted(async () => {
  try {
    const data = await $fetch<{ days: DayStats[] }>('/api/words/daily-stats')
    days.value = data.days
  } catch {}
  loading.value = false
})

definePageMeta({ layout: false })
</script>

<style scoped>
.daily-page {
  display: flex; flex-direction: column;
  height: 100vh; background: #f7f6f3;
  font-family: 'DM Sans', system-ui, sans-serif; color: #1a1a18;
}
.dl-body {
  flex: 1; overflow-y: auto;
  padding: 20px 36px 60px;
  max-width: 800px; width: 100%; margin: 0 auto;
}

/* ── 月份切换 ── */
.dl-month-nav {
  display: flex; align-items: center; justify-content: center; gap: 16px;
  margin-bottom: 12px;
}
.dl-mn-btn {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 50%;
  border: none; background: #f0efe9; color: #6b6963;
  cursor: pointer; transition: all 0.12s;
}
.dl-mn-btn:hover:not(:disabled) { background: #e5e3db; color: #3d3591; }
.dl-mn-btn:disabled { opacity: 0.3; cursor: default; }
.dl-month-label {
  font-family: 'Lora', Georgia, serif;
  font-size: 1.05rem; font-weight: 600; margin: 0; min-width: 120px; text-align: center;
}

/* ── 图例 ── */
.dl-legend {
  display: flex; justify-content: center; gap: 14px; margin-bottom: 10px;
}
.dl-lg {
  display: flex; align-items: center; gap: 4px;
  font-size: 0.68rem; color: #a09e97;
}
.dl-lg-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }

/* ── 星期 ── */
.dl-weekdays {
  display: grid; grid-template-columns: repeat(7, 1fr);
  text-align: center; margin-bottom: 3px;
}
.dl-wd { font-size: 0.62rem; color: #a09e97; font-weight: 500; padding: 4px 0; }

/* ── 日历格 ── */
.dl-grid {
  display: grid; grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}
.dl-cell {
  display: flex; flex-direction: column; align-items: center;
  padding: 6px 2px 8px;
  border-radius: 8px; cursor: default;
  transition: background 0.12s;
  min-height: 56px;
}
.dl-cell.empty { background: transparent; }
.dl-cell:not(.empty) { background: #f7f6f3; }
.dl-cell.has-data { cursor: pointer; }
.dl-cell.has-data:hover { background: #edeafd; }
.dl-cell.today { box-shadow: inset 0 0 0 1.5px #6366f1; }
.dl-cell-date {
  font-family: 'DM Mono', monospace;
  font-size: 0.78rem; font-weight: 500; color: #6b6963;
  line-height: 1;
}
.dl-cell.today .dl-cell-date { color: #6366f1; font-weight: 600; }
.dl-cell-count {
  font-family: 'DM Mono', monospace;
  font-size: 0.85rem; font-weight: 700; color: #1a1a18;
  margin-top: 2px; line-height: 1;
}
.dl-cell-dots {
  display: flex; gap: 2px; margin-top: 3px;
}
.dl-dot {
  width: 5px; height: 5px; border-radius: 50%; display: inline-block;
}

/* ── 空态 ── */
.dl-empty, .dl-loading {
  text-align: center; padding: 60px 20px; color: #a09e97;
}
</style>
