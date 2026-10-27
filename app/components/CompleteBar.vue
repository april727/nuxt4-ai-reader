<template>
  <div class="cb-wrap">
    <div v-if="!open" class="cb-bar">
      <div class="cb-info">
        <span class="cb-title">{{ done ? '这篇已完成' : '读完这篇了吗？' }}</span>
        <span class="cb-sub">{{ done ? `下次复习 ${nextLabel}` : '完成后会安排复习提醒' }}</span>
      </div>
      <div class="cb-actions">
        <button v-if="done" class="cb-ghost" @click="undo">撤销完成</button>
        <button class="cb-primary" @click="open = true">{{ done ? '再读一次' : '完成阅读' }}</button>
      </div>
    </div>

    <div v-else class="cb-panel">
      <p class="cb-q">这次读得怎么样？</p>
      <div class="cb-ratings">
        <button
          v-for="r in ratings"
          :key="r.key"
          class="cb-rating"
          :class="{ active: rating === r.key }"
          @click="rating = r.key"
        >{{ r.label }}</button>
      </div>

      <p class="cb-q">下次复习</p>
      <div class="cb-intervals">
        <button
          v-for="d in [3, 7, 14, 30]"
          :key="d"
          class="cb-int"
          :class="{ active: intervalDays === d }"
          @click="intervalDays = d"
        >{{ d }} 天</button>
        <span class="cb-preview">→ {{ previewDate }}</span>
      </div>

      <div class="cb-foot">
        <button class="cb-ghost" @click="open = false" :disabled="saving">取消</button>
        <button class="cb-primary" @click="submit" :disabled="saving">{{ saving ? '保存中…' : '确认完成' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ textId: string; completedAt?: string | null; nextReviewAt?: string | null }>()
const emit = defineEmits<{ done: [payload: { nextReviewAt: string; intervalDays: number }] }>()

const open = ref(false)
const saving = ref(false)
const rating = ref<'good' | 'fair' | 'hard'>('fair')
const intervalDays = ref(7)
/** 由组件自己拉取完成态，避免让主页面新增状态（降低耦合与回归风险） */
const done = ref(!!props.completedAt)
const nextAt = ref(props.nextReviewAt || '')

onMounted(async () => {
  if (props.completedAt !== undefined) return
  try {
    const t = await $fetch<any>(`/api/text/${props.textId}`)
    done.value = !!(t?.done ?? t?.data?.completedAt)
    nextAt.value = t?.nextReviewAt ?? t?.data?.nextReviewAt ?? ''
  } catch {}
})

const ratings = [
  { key: 'good' as const, label: '读懂了' },
  { key: 'fair' as const, label: '大致看懂' },
  { key: 'hard' as const, label: '还需再看' },
]
const MULT = { good: 1.5, fair: 1, hard: 0.5 }

/** 与服务端一致：间隔 = 基准 × 自评乘数，夹取 1~90 天 */
const previewDays = computed(() =>
  Math.min(90, Math.max(1, Math.round(intervalDays.value * MULT[rating.value]))),
)

function fmt(d: Date) {
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const previewDate = computed(() => {
  const d = new Date()
  d.setDate(d.getDate() + previewDays.value)
  return fmt(d)
})
const nextLabel = computed(() => {
  if (!nextAt.value) return '—'
  const parts = String(nextAt.value).split('-')
  return parts.length === 3 ? `${parts[1]}-${parts[2]}` : String(nextAt.value)
})

async function submit() {
  if (saving.value) return
  saving.value = true
  try {
    const res = await $fetch<{ nextReviewAt: string; intervalDays: number }>('/api/text/complete', {
      method: 'POST',
      body: { id: props.textId, action: 'complete', rating: rating.value, intervalDays: intervalDays.value },
    })
    open.value = false
    done.value = true
    nextAt.value = res.nextReviewAt
    emit('done', { nextReviewAt: res.nextReviewAt, intervalDays: res.intervalDays })
  } catch (e: any) {
    alert('保存失败: ' + (e?.message || ''))
  } finally {
    saving.value = false
  }
}

async function undo() {
  if (saving.value) return
  saving.value = true
  try {
    await $fetch('/api/text/complete', { method: 'POST', body: { id: props.textId, action: 'uncomplete' } })
    done.value = false
    nextAt.value = ''
    emit('done', { nextReviewAt: '', intervalDays: 0 })
  } catch (e: any) {
    alert('撤销失败: ' + (e?.message || ''))
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.cb-wrap { margin: 18px 0 8px; }
.cb-bar, .cb-panel {
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.07);
  border-radius: 12px;
  padding: 12px 14px;
}
.cb-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.cb-title { display: block; font-size: 13.5px; color: #1a1a18; }
.cb-sub { display: block; margin-top: 2px; font-size: 11.5px; color: #9a978e; }
.cb-actions { display: flex; gap: 8px; }

.cb-primary {
  border: none; border-radius: 8px; background: #3d3591; color: #fff;
  padding: 6px 13px; font-size: 12.5px; font-family: inherit; cursor: pointer;
}
.cb-primary:disabled { opacity: 0.6; cursor: default; }
.cb-ghost {
  border: 1px solid rgba(0, 0, 0, 0.12); border-radius: 8px; background: transparent;
  color: #6b6a63; padding: 6px 12px; font-size: 12.5px; font-family: inherit; cursor: pointer;
}

.cb-q { margin: 0 0 8px; font-size: 12.5px; color: #6b6a63; }
.cb-q + .cb-ratings { margin-bottom: 14px; }
.cb-ratings, .cb-intervals { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; align-items: center; }
.cb-rating, .cb-int {
  border: 1px solid rgba(0, 0, 0, 0.1); border-radius: 8px; background: transparent;
  padding: 6px 12px; font-size: 12.5px; color: #6b6a63; font-family: inherit; cursor: pointer;
}
.cb-rating.active { border-color: #1d9e75; background: #e8f5ef; color: #147a59; font-weight: 500; }
.cb-int { border-radius: 20px; padding: 4px 11px; }
.cb-int.active { border-color: #534ab7; background: #eeedfe; color: #534ab7; font-weight: 500; }
.cb-preview { font-size: 11.5px; color: #9a6207; }
.cb-foot { display: flex; justify-content: flex-end; gap: 8px; }
</style>
