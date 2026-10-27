<template>
  <div class="rp-page">
    <PageHeader title="重点攻克" active="wordbooks" back-to="/wordbooks" back-label="单词本">
      <template #actions>
        <NuxtLink to="/wordbooks/wb_default" class="rp-hdr-link">默认单词本</NuxtLink>
      </template>
    </PageHeader>

    <div class="rp-body">
      <p class="rp-intro">
        同一个词被反复标记，说明它一直没真正掌握。这里按标记次数排出优先级 ——
        次数越多越该优先解决。计数已剔除保存链路产生的重复写入。
      </p>

      <div class="rp-filters">
        <div class="rp-seg">
          <button
            v-for="m in minOptions"
            :key="m.value"
            class="rp-seg-btn"
            :class="{ active: minCount === m.value }"
            @click="minCount = m.value"
          >≥ {{ m.value }} 次</button>
        </div>
        <label class="rp-check">
          <input v-model="onlyCrossDoc" type="checkbox" />
          <span>只看跨篇重复（≥2 篇）</span>
        </label>
        <div class="rp-seg rp-sort">
          <button class="rp-seg-btn" :class="{ active: sortBy === 'count' }" @click="sortBy = 'count'">按次数</button>
          <button class="rp-seg-btn" :class="{ active: sortBy === 'docs' }" @click="sortBy = 'docs'">按篇数</button>
        </div>
      </div>

      <div v-if="pending" class="rp-state">加载中…</div>
      <div v-else-if="error" class="rp-state is-error">加载失败：{{ error }}</div>
      <div v-else-if="!shown.length" class="rp-state">没有符合条件的词。继续阅读并标记，这里会自动汇总。</div>

      <ul v-else class="rp-list">
        <li v-for="it in shown" :key="it.term" class="rp-item">
          <div class="rp-main">
            <div class="rp-term-row">
              <span class="rp-term">{{ it.term }}</span>
              <span v-if="it.phonetic" class="rp-phon">{{ it.phonetic }}</span>
              <span class="rp-badge is-count">{{ it.markCount }} 次</span>
              <span class="rp-badge">{{ it.docCount }} 篇</span>
              <span class="rp-type" :class="`is-${it.type}`">{{ typeLabel(it.type) }}</span>
            </div>
            <p v-if="it.meaning" class="rp-meaning">{{ it.meaning }}</p>
            <p v-else class="rp-meaning is-empty">暂无释义</p>
            <div class="rp-docs">
              <NuxtLink
                v-for="d in it.docs"
                :key="d.textId"
                :to="`/read/${d.textId}`"
                class="rp-doc"
                :title="d.title"
              >{{ d.title }}<span v-if="d.n > 1" class="rp-doc-n">×{{ d.n }}</span></NuxtLink>
            </div>
          </div>
        </li>
      </ul>

      <p v-if="shown.length" class="rp-foot">共 {{ shown.length }} 个词（按当前筛选）</p>
    </div>
  </div>
</template>

<script setup lang="ts">
interface RepeatItem {
  term: string
  type: string
  markCount: number
  rawCount: number
  docCount: number
  lastAt: string
  phonetic: string
  meaning: string
  pos: string
  docs: { textId: string; title: string; n: number }[]
}

const minOptions = [
  { value: 2, label: '≥2 次' },
  { value: 3, label: '≥3 次' },
  { value: 5, label: '≥5 次' },
]
const minCount = ref(2)
const onlyCrossDoc = ref(true)
const sortBy = ref<'count' | 'docs'>('count')

const { data, pending, error } = await useAsyncData(
  'repeat-words',
  () => $fetch<{ items: RepeatItem[] }>('/api/wordbooks/repeat', { query: { min: 2, limit: 300 } }),
  { server: false },
)

const all = computed<RepeatItem[]>(() => data.value?.items || [])

const shown = computed(() => {
  let list = all.value.filter(i => i.markCount >= minCount.value)
  if (onlyCrossDoc.value) list = list.filter(i => i.docCount >= 2)
  return [...list].sort((a, b) =>
    sortBy.value === 'docs' ? b.docCount - a.docCount || b.markCount - a.markCount : b.markCount - a.markCount,
  )
})

function typeLabel(t: string) {
  return t === 'phrase' ? '短语' : t === 'sentence' ? '句子' : '单词'
}

useHead({ title: '重点攻克 · 阅读' })
</script>

<style scoped>
.rp-page { min-height: 100vh; background: #f7f6f2; }
.rp-body { max-width: 860px; margin: 0 auto; padding: 28px 20px 64px; }
.rp-hdr-link { font-size: 13px; color: #6b6a63; text-decoration: none; }
.rp-hdr-link:hover { color: #3d3591; }

.rp-intro {
  margin: 0 0 18px;
  font-size: 13px;
  line-height: 1.7;
  color: #6b6a63;
}

.rp-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}
.rp-seg { display: inline-flex; background: #eeede7; border-radius: 9px; padding: 3px; }
.rp-seg-btn {
  border: none;
  background: transparent;
  padding: 5px 11px;
  border-radius: 7px;
  font-size: 12.5px;
  color: #6b6a63;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.16s, color 0.16s;
}
.rp-seg-btn.active { background: #fff; color: #3d3591; font-weight: 500; }
.rp-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: #6b6a63; cursor: pointer; }
.rp-sort { margin-left: auto; }

.rp-state {
  padding: 48px 0;
  text-align: center;
  font-size: 13px;
  color: #8a8880;
}
.rp-state.is-error { color: #a33a3a; }

.rp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.rp-item {
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 12px;
  padding: 14px 16px;
  transition: border-color 0.16s;
}
.rp-item:hover { border-color: rgba(61, 53, 145, 0.25); }

.rp-term-row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; }
.rp-term {
  font-family: 'Lora', Georgia, serif;
  font-size: 17px;
  color: #1a1a18;
}
.rp-phon { font-size: 12px; color: #8a8880; }
.rp-badge {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 20px;
  background: #f2f1ec;
  color: #6b6a63;
}
.rp-badge.is-count { background: #fdf0dc; color: #9a6207; }
.rp-type { font-size: 11px; color: #a09e97; margin-left: auto; }
.rp-type.is-phrase { color: #17886a; }
.rp-type.is-sentence { color: #c04a70; }

.rp-meaning {
  margin: 7px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: #4a4a45;
}
.rp-meaning.is-empty { color: #b5b2a9; }

.rp-docs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.rp-doc {
  font-size: 11.5px;
  color: #6b6a63;
  background: #f7f6f2;
  border-radius: 6px;
  padding: 3px 8px;
  text-decoration: none;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rp-doc:hover { background: #eeedf7; color: #3d3591; }
.rp-doc-n { margin-left: 4px; color: #9a6207; }

.rp-foot { margin: 16px 0 0; font-size: 12px; color: #a09e97; text-align: center; }

@media (max-width: 640px) {
  .rp-body { padding: 20px 14px 48px; }
  .rp-sort { margin-left: 0; }
}
</style>
