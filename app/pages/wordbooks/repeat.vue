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
        <li
          v-for="(it, idx) in shown"
          :key="it.term"
          class="rp-card"
          :class="{ 'is-hot': idx < 3 }"
        >
          <div class="rp-card-head">
            <span class="rp-rank" :title="`优先级第 ${idx + 1}`">{{ idx + 1 }}</span>
            <div class="rp-titles">
              <div class="rp-term-line">
                <span class="rp-term">{{ it.term }}</span>
                <span v-if="it.phonetic" class="rp-phon">{{ it.phonetic }}</span>
              </div>
              <p v-if="it.meaning" class="rp-meaning" :title="it.meaning">{{ it.meaning }}</p>
              <p v-else class="rp-meaning is-empty">暂无释义</p>
            </div>
            <div class="rp-hits">
              <span class="rp-hits-n">{{ it.markCount }}</span>
              <span class="rp-hits-u">次</span>
            </div>
          </div>

          <div class="rp-card-foot">
            <div class="rp-meta-left">
              <span class="rp-type" :class="`is-${it.type}`">{{ typeLabel(it.type) }}</span>
              <span class="rp-dot">·</span>
              <span class="rp-docs-n">{{ it.docCount }} 篇</span>
            </div>
            <div class="rp-docs">
              <NuxtLink
                v-for="d in it.docs.slice(0, 3)"
                :key="d.textId"
                :to="`/read/${d.textId}`"
                class="rp-doc"
                :title="d.title"
              >{{ d.title }}<span v-if="d.n > 1" class="rp-doc-n">×{{ d.n }}</span></NuxtLink>
              <span v-if="it.docs.length > 3" class="rp-doc-more" :title="restTitles(it)">+{{ it.docs.length - 3 }}</span>
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

/** 被「+N」收起来的那些篇名，挂在 title 上备查 */
function restTitles(it: RepeatItem) {
  return it.docs.slice(3).map(d => d.title).join('\n')
}

useHead({ title: '重点攻克 · 阅读' })
</script>

<style scoped>
/*
 * 全局 body 是 overflow:hidden + height:100vh（阅读页需要锁死滚动），
 * 所以任何要滚动的页面都得自己当滚动容器：外层 100vh 撑满、内层 overflow-y:auto。
 * 之前这里只写了 min-height:100vh —— 内容超出后没有滚动条，页面就"卡死"了。
 */
.rp-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #f7f6f2;
}
.rp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  max-width: 1080px;
  width: 100%;
  margin: 0 auto;
  padding: 24px 20px 64px;
}
.rp-hdr-link { font-size: 13px; color: #6b6a63; text-decoration: none; }
.rp-hdr-link:hover { color: #3d3591; }

.rp-intro {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.7;
  color: #6b6a63;
}

/* 筛选条吸顶：两列长列表滚下去以后仍能改条件 */
.rp-filters {
  position: sticky;
  top: -24px;
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin: 0 0 16px;
  padding: 12px 0 10px;
  background: #f7f6f2;
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

/* ---- 两列单词卡 ---- */
.rp-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-items: stretch;
}
.rp-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-left: 3px solid rgba(0, 0, 0, 0.07);
  border-radius: 11px;
  padding: 12px 14px 11px;
  transition: border-color 0.16s, box-shadow 0.16s, transform 0.16s;
}
.rp-card:hover {
  border-color: rgba(61, 53, 145, 0.22);
  box-shadow: 0 3px 14px rgba(40, 36, 90, 0.07);
  transform: translateY(-1px);
}
/* 优先级前三：左侧色条加粗着色 */
.rp-card.is-hot { border-left-color: #d9a04a; }

.rp-card-head { display: flex; align-items: flex-start; gap: 9px; }
.rp-rank {
  flex-shrink: 0;
  min-width: 20px;
  height: 20px;
  border-radius: 6px;
  background: #f2f1ec;
  color: #8a8880;
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
}
.is-hot .rp-rank { background: #fdf0dc; color: #9a6207; }

.rp-titles { flex: 1; min-width: 0; }
.rp-term-line { display: flex; align-items: baseline; flex-wrap: wrap; gap: 7px; }
.rp-term {
  font-family: 'Lora', Georgia, serif;
  font-size: 16.5px;
  line-height: 1.35;
  color: #1a1a18;
  word-break: break-word;
}
.rp-phon { font-size: 11.5px; color: #a09e97; }

.rp-meaning {
  margin: 4px 0 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: #55544e;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.rp-meaning.is-empty { color: #b5b2a9; font-style: italic; }

.rp-hits {
  flex-shrink: 0;
  display: flex;
  align-items: baseline;
  gap: 2px;
  color: #9a6207;
  font-variant-numeric: tabular-nums;
}
.rp-hits-n { font-size: 17px; font-weight: 500; line-height: 1.1; }
.rp-hits-u { font-size: 10.5px; color: #b08b4c; }

.rp-card-foot {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-top: 9px;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
  margin-top: auto;
}
.rp-meta-left { display: flex; align-items: center; gap: 5px; font-size: 11px; }
.rp-type { color: #a09e97; }
.rp-type.is-phrase { color: #17886a; }
.rp-type.is-sentence { color: #c04a70; }
.rp-dot { color: #cfccc3; }
.rp-docs-n { color: #8a8880; font-variant-numeric: tabular-nums; }

.rp-docs { display: flex; flex-wrap: wrap; gap: 5px; }
.rp-doc {
  font-size: 11px;
  color: #6b6a63;
  background: #f7f6f2;
  border-radius: 5px;
  padding: 2px 7px;
  text-decoration: none;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rp-doc:hover { background: #eeedf7; color: #3d3591; }
.rp-doc-n { margin-left: 3px; color: #9a6207; }
.rp-doc-more {
  font-size: 11px;
  color: #a09e97;
  background: #f2f1ec;
  border-radius: 5px;
  padding: 2px 6px;
  cursor: default;
}

.rp-foot {
  margin: 18px 0 0;
  font-size: 12px;
  color: #a09e97;
  text-align: center;
}

@media (max-width: 760px) {
  .rp-list { grid-template-columns: minmax(0, 1fr); }
  .rp-body { padding: 18px 14px 48px; }
  .rp-filters { position: static; }
  .rp-sort { margin-left: 0; }
}
</style>
