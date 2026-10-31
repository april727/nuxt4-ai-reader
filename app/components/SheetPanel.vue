<template>
  <div class="sp">
    <div class="sp-head">
      <span class="sp-title">标注</span>
      <span class="sp-count">{{ annotations.length }}</span>
    </div>

    <div class="sp-filters">
      <button
        v-for="f in filters"
        :key="f.k"
        class="sp-chip"
        :class="{ on: filter === f.k }"
        :style="filter === f.k && f.k !== 'all' ? { borderColor: f.color, color: f.color } : {}"
        @click="filter = f.k"
      >
        <i v-if="f.k !== 'all'" class="dot" :style="{ background: f.color }"></i>
        {{ f.label }}
        <span class="n">{{ countOf(f.k) }}</span>
      </button>
    </div>

    <!-- 整卷判分汇总：总分不落库，这里按现存题目现算 -->
    <div class="sp-grade">
      <div class="sp-grade-top">
        <span class="sp-grade-title">判分</span>
        <span class="sp-grade-score">{{ gotTotal }}<i>/{{ maxTotal }}</i></span>
        <span v-if="maxTotal" class="sp-grade-rate">{{ rate }}%</span>
        <span class="sp-grade-flex"></span>
        <button v-if="gradedCount" class="sp-grade-clear" title="清空整卷判分" @click="emit('resetGrading')">清空</button>
      </div>
      <div v-if="maxTotal" class="sp-grade-bar"><i :style="{ width: rate + '%' }"></i></div>
      <div v-else class="sp-grade-hint">框出题目后，选中它即可判对错</div>
    </div>

    <div class="sp-list">
      <div v-if="!visible.length" class="sp-empty">
        <p>还没有标注</p>
        <p class="hint">左侧切到「框选」，拖出一个框即可存下这道题</p>
      </div>
      <div v-for="a in visible" :key="a.id" class="sp-item" :class="{ open: a.id === selectedId, active: a.id === selectedId }">
        <div class="sp-item-row" @click="emit('select', a.id)">
          <span class="badge" :style="{ background: metaOf(a.kind).color }">{{ idxOf(a) }}</span>
          <div class="sp-item-main">
            <div class="sp-item-top">
              <span class="kind" :style="{ color: metaOf(a.kind).color }">{{ metaOf(a.kind).label }}</span>
              <span class="page">第 {{ pageNo(a.pageId) }} 页</span>
              <span v-if="gOf(a.id)" class="item-score" :style="{ color: scoreColor(a.id) }">{{ scoreText(a.id) }}</span>
            </div>
            <div class="sp-item-note">{{ a.note || '（无备注）' }}</div>
          </div>
          <button class="del" title="删除" @click.stop="emit('remove', a.id)">×</button>
        </div>

        <div v-if="a.id === selectedId" class="sp-item-edit">
          <div class="kind-row">
            <button
              v-for="m in kinds"
              :key="m.k"
              class="kind-btn"
              :class="{ on: a.kind === m.k }"
              :style="a.kind === m.k ? { borderColor: m.color, color: m.color, background: m.wash } : {}"
              @click="emit('setKind', a.id, m.k)"
            >{{ m.label }}</button>
          </div>
          <div class="grade-box">
            <div class="grade-verdicts">
              <button
                v-for="m in verdicts"
                :key="m.v"
                class="grade-v"
                :class="{ on: gOf(a.id)?.verdict === m.v }"
                :style="gOf(a.id)?.verdict === m.v ? { borderColor: m.color, color: '#fff', background: m.color } : { color: m.color }"
                :title="`判为「${m.label}」，得分自动给 ${autoScoreHint(a.id, m.v)}`"
                @click="emit('setVerdict', a.id, m.v)"
              >{{ m.mark }} {{ m.label }}</button>
            </div>
            <div class="grade-nums">
              <label class="gn">
                <span>满分</span>
                <input
                  type="number" min="0" step="0.5" inputmode="decimal"
                  :value="gOf(a.id)?.max ?? DEFAULT_MAX_SCORE"
                  @change="onNum(a.id, 'max', $event)"
                >
              </label>
              <label class="gn">
                <span>得分</span>
                <input
                  type="number" min="0" step="0.5" inputmode="decimal"
                  :value="gOf(a.id)?.got ?? 0"
                  @change="onNum(a.id, 'got', $event)"
                >
              </label>
              <span class="gn-total">分</span>
            </div>
          </div>
          <textarea
            class="note-input"
            :value="a.note || ''"
            rows="2"
            placeholder="为什么标它？一句话就够"
            @input="emit('setNote', a.id, ($event.target as HTMLTextAreaElement).value)"
          ></textarea>
          <div class="edit-foot">
            <button class="goto" @click="emit('goto', a.pageId, a.id)">定位到原图</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 答案遮挡：只管当前页 -->
    <div class="sp-covers">
      <div class="sp-covers-head">
        <span>答案遮挡</span>
        <span class="sp-covers-meta">第 {{ currentPageNo }} 页 · {{ covers.length }} 处</span>
      </div>
      <div v-if="!covers.length" class="sp-covers-empty">
        切到顶栏「遮答案」，拖框盖住答案区，复习时会自动盖上
      </div>
      <div v-else class="sp-covers-list">
        <span v-for="(c, i) in covers" :key="i" class="sp-cover-chip">
          <button class="sp-cover-goto" title="定位到原图" @click="emit('focusCover', i)">遮 {{ i + 1 }}</button>
          <button class="sp-cover-del" title="删除这块遮挡" @click="emit('removeCover', i)">×</button>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { SheetAnno, SheetPage, SheetGrade } from '~/utils/sheetTypes'
import { SHEET_KINDS, SHEET_VERDICTS, DEFAULT_MAX_SCORE, sheetKindMeta, sheetVerdictMeta } from '~/utils/sheetTypes'

const props = defineProps<{
  annotations: SheetAnno[]
  pages: SheetPage[]
  selectedId?: string
  /** 当前页的答案遮挡区 */
  covers?: { x: number; y: number; w: number; h: number }[]
  /** 当前页码（从 1 开始） */
  pageNo?: number
  /** 整卷判分，key 为 annotation id */
  grading?: Record<string, SheetGrade>
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'remove', id: string): void
  (e: 'setKind', id: string, kind: string): void
  (e: 'setNote', id: string, note: string): void
  (e: 'goto', pageId: string, id: string): void
  (e: 'removeCover', index: number): void
  (e: 'focusCover', index: number): void
  (e: 'setVerdict', id: string, verdict: string): void
  (e: 'setScore', id: string, field: 'max' | 'got', value: number): void
  (e: 'resetGrading'): void
}>()

const covers = computed(() => props.covers || [])
const currentPageNo = computed(() => props.pageNo || 1)

const kinds = SHEET_KINDS

const filters = [
  { k: 'all', label: '全部', color: '#3d3591' },
  ...SHEET_KINDS.map(m => ({ k: m.k, label: m.label, color: m.color })),
]

const filter = ref<string>('all')

const metaOf = sheetKindMeta

function countOf(k: string) {
  return k === 'all' ? props.annotations.length : props.annotations.filter(a => a.kind === k).length
}

const visible = computed(() =>
  filter.value === 'all' ? props.annotations : props.annotations.filter(a => a.kind === filter.value),
)

/** 编号与画布上的角标保持一致：按页内顺序，不跨页 */
function idxOf(a: SheetAnno) {
  const samePage = props.annotations.filter(x => x.pageId === a.pageId)
  return samePage.findIndex(x => x.id === a.id) + 1
}

function pageNo(pageId: string) {
  return Math.max(1, props.pages.findIndex(p => p.id === pageId) + 1)
}

// ── 判分 ──
const verdicts = SHEET_VERDICTS

/** 未判分的题返回 null：控件显示默认满分与 0 分，但没有任何判定被选中 */
function gOf(annoId: string): SheetGrade | null {
  return props.grading?.[annoId] || null
}

/** 提示文案：点这个判定会把得分自动定成多少，省得用户猜 */
function autoScoreHint(annoId: string, verdict: string) {
  const max = gOf(annoId)?.max ?? DEFAULT_MAX_SCORE
  if (verdict === 'right') return `${round2(max)} 分`
  if (verdict === 'half') return `${round2(max / 2)} 分`
  return '0 分'
}

function onNum(annoId: string, field: 'max' | 'got', e: Event) {
  const raw = Number((e.target as HTMLInputElement).value)
  emit('setScore', annoId, field, Number.isFinite(raw) ? raw : 0)
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

/**
 * 统计只算「现存标注」的分数。
 * grading 里可能还留着已被删掉的框（服务端下次保存才清理），
 * 直接按 grading 求和会把幽灵分算进总分。
 */
const gradedEntries = computed(() => {
  const g = props.grading || {}
  return props.annotations.map(a => g[a.id]).filter(Boolean) as SheetGrade[]
})

const gradedCount = computed(() => gradedEntries.value.length)
const maxTotal = computed(() => round2(gradedEntries.value.reduce((s, g) => s + (g.max || 0), 0)))
const gotTotal = computed(() => round2(gradedEntries.value.reduce((s, g) => s + (g.got || 0), 0)))
const rate = computed(() => (maxTotal.value > 0 ? Math.round((gotTotal.value / maxTotal.value) * 100) : 0))

function scoreText(annoId: string) {
  const g = gOf(annoId)
  if (!g) return ''
  return `${sheetVerdictMeta(g.verdict).mark} ${round2(g.got)}/${round2(g.max)}`
}

function scoreColor(annoId: string) {
  const g = gOf(annoId)
  return g ? sheetVerdictMeta(g.verdict).color : ''
}
</script>

<style scoped>
.sp { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.sp-head {
  display: flex; align-items: center; gap: 7px;
  padding: 12px 14px 8px; flex-shrink: 0;
}
.sp-title { font-size: 13px; font-weight: 500; color: #1a1a18; }
.sp-count {
  font-size: 11px; color: #8a8880; background: rgba(0, 0, 0, 0.05);
  border-radius: 20px; padding: 1px 7px; font-variant-numeric: tabular-nums;
}

.sp-filters {
  display: flex; flex-wrap: wrap; gap: 5px;
  padding: 0 14px 10px; flex-shrink: 0;
}

/* ── 判分汇总 ── */
.sp-grade {
  flex-shrink: 0;
  margin: 0 14px 10px;
  padding: 9px 11px 10px;
  border-radius: 9px;
  background: rgba(61, 53, 145, 0.045);
  border: 0.5px solid rgba(61, 53, 145, 0.12);
}
.sp-grade-top { display: flex; align-items: baseline; gap: 7px; }
.sp-grade-title {
  font-size: 11px; color: #6b6862; letter-spacing: 0.3px;
}
.sp-grade-score {
  font-family: 'DM Mono', monospace; font-size: 19px; font-weight: 600;
  color: #1a1a18; font-variant-numeric: tabular-nums; line-height: 1.1;
}
.sp-grade-score i { font-style: normal; font-size: 12.5px; font-weight: 400; color: #a09e97; }
.sp-grade-rate {
  font-size: 11px; color: #3d3591; background: rgba(61, 53, 145, 0.09);
  border-radius: 20px; padding: 1px 6px; font-variant-numeric: tabular-nums;
}
.sp-grade-flex { flex: 1; }
.sp-grade-clear {
  border: none; background: transparent; cursor: pointer; padding: 2px 3px;
  font-family: 'DM Sans', sans-serif; font-size: 11.5px; color: #a09e97;
}
.sp-grade-clear:hover { color: #a32d2d; }
.sp-grade-bar {
  height: 3px; border-radius: 2px; margin-top: 7px;
  background: rgba(0, 0, 0, 0.07); overflow: hidden;
}
.sp-grade-bar i { display: block; height: 100%; border-radius: 2px; background: #0f6e56; transition: width 0.18s; }
.sp-grade-hint { font-size: 11px; color: #a09e97; margin-top: 6px; line-height: 1.4; }

/* ── 单题判分控件 ── */
.grade-box { margin-bottom: 7px; }
.grade-verdicts { display: flex; gap: 4px; margin-bottom: 5px; }
.grade-v {
  flex: 1; border: 0.5px solid rgba(0, 0, 0, 0.14); background: transparent;
  border-radius: 6px; padding: 4px 0; cursor: pointer;
  font-family: 'DM Sans', sans-serif; font-size: 11.5px; font-weight: 500;
  transition: background 0.12s, color 0.12s;
}
.grade-v:hover { background: rgba(0, 0, 0, 0.04); }
.grade-nums { display: flex; align-items: center; gap: 6px; }
.gn { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #6b6862; }
.gn input {
  width: 46px; box-sizing: border-box;
  border: 0.5px solid rgba(0, 0, 0, 0.14); border-radius: 5px;
  padding: 3px 5px; font-family: 'DM Mono', monospace; font-size: 12px;
  color: #1a1a18; background: #fff; outline: none;
  font-variant-numeric: tabular-nums;
}
.gn input:focus { border-color: rgba(61, 53, 145, 0.45); }
.gn-total { font-size: 10.5px; color: #a09e97; }
.item-score {
  font-family: 'DM Mono', monospace; font-size: 10.5px; font-weight: 500;
  margin-left: auto; font-variant-numeric: tabular-nums;
}
.sp-chip {
  display: inline-flex; align-items: center; gap: 4px;
  border: 0.5px solid rgba(0, 0, 0, 0.14); background: transparent;
  border-radius: 20px; padding: 3px 9px; cursor: pointer;
  font-family: 'DM Sans', sans-serif; font-size: 11.5px; color: #6b6862;
}
.sp-chip:hover { background: rgba(0, 0, 0, 0.03); }
.sp-chip.on { background: #fff; }
.sp-chip .dot { width: 6px; height: 6px; border-radius: 50%; display: block; }
.sp-chip .n { color: #a09e97; font-variant-numeric: tabular-nums; }

.sp-list { flex: 1; overflow-y: auto; padding: 0 10px 14px; }
.sp-empty { padding: 26px 10px; text-align: center; color: #8a8880; font-size: 12.5px; }
.sp-empty .hint { color: #a09e97; font-size: 11.5px; margin-top: 5px; }

.sp-item {
  border-radius: 9px; margin-bottom: 4px;
  border: 0.5px solid transparent;
}
.sp-item.active { background: rgba(255, 255, 255, 0.9); border-color: rgba(0, 0, 0, 0.1); }
.sp-item-row {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 8px 8px 8px 6px; cursor: pointer; border-radius: 9px;
}
.sp-item-row:hover { background: rgba(0, 0, 0, 0.03); }
.badge {
  flex-shrink: 0; min-width: 17px; height: 17px; border-radius: 4px;
  color: #fff; font-size: 10.5px; font-family: 'DM Mono', monospace;
  display: flex; align-items: center; justify-content: center; margin-top: 1px;
}
.sp-item-main { flex: 1; min-width: 0; }
.sp-item-top { display: flex; align-items: baseline; gap: 6px; }
.kind { font-size: 12px; font-weight: 500; }
.page { font-size: 10.5px; color: #a09e97; }
.sp-item-note {
  font-size: 12px; color: #6b6862; margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.del {
  border: none; background: transparent; cursor: pointer;
  color: #b4b2a9; font-size: 15px; line-height: 1; padding: 0 2px;
}
.del:hover { color: #a32d2d; }

.sp-item-edit { padding: 2px 8px 10px; }
.kind-row { display: flex; gap: 4px; margin-bottom: 6px; }
.kind-btn {
  flex: 1; border: 0.5px solid rgba(0, 0, 0, 0.14); background: transparent;
  border-radius: 6px; padding: 4px 0; cursor: pointer;
  font-family: 'DM Sans', sans-serif; font-size: 11.5px; color: #6b6862;
}
.note-input {
  width: 100%; box-sizing: border-box; resize: vertical;
  border: 0.5px solid rgba(0, 0, 0, 0.12); border-radius: 7px;
  padding: 6px 8px; font-family: inherit; font-size: 12px; color: #1a1a18;
  background: #fff; outline: none; line-height: 1.5;
}
.note-input:focus { border-color: rgba(61, 53, 145, 0.45); }
.edit-foot { display: flex; justify-content: flex-end; margin-top: 5px; }
.goto {
  border: none; background: transparent; cursor: pointer;
  font-family: 'DM Sans', sans-serif; font-size: 11.5px; color: #3d3591;
  padding: 2px 4px;
}
.goto:hover { text-decoration: underline; }

.sp-covers {
  flex-shrink: 0;
  border-top: 0.5px solid rgba(0, 0, 0, 0.08);
  padding: 10px 14px 12px;
  background: rgba(255, 255, 255, 0.5);
}
.sp-covers-head {
  display: flex; align-items: baseline; justify-content: space-between;
  font-size: 12px; font-weight: 500; color: #1a1a18; margin-bottom: 6px;
}
.sp-covers-meta { font-size: 10.5px; font-weight: 400; color: #a09e97; }
.sp-covers-empty { font-size: 11.5px; color: #a09e97; line-height: 1.5; }
.sp-covers-list { display: flex; flex-wrap: wrap; gap: 5px; }
.sp-cover-chip {
  display: inline-flex; align-items: center; gap: 2px;
  border: 0.5px solid rgba(0, 0, 0, 0.14); border-radius: 20px;
  padding: 1px 3px 1px 8px; background: #fff;
}
.sp-cover-goto {
  border: none; background: transparent; cursor: pointer;
  font-family: 'DM Sans', sans-serif; font-size: 11px; color: #6b6862; padding: 2px 0;
}
.sp-cover-goto:hover { color: #3d3591; }
.sp-cover-del {
  border: none; background: transparent; cursor: pointer;
  color: #b4b2a9; font-size: 13px; line-height: 1; padding: 0 3px;
}
.sp-cover-del:hover { color: #a32d2d; }
</style>
