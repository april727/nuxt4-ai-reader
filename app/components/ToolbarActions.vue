<template>
  <div class="ta-group">
    <!-- 学习下拉 -->
    <div class="ta-dropdown" ref="learnRef">
      <button class="ta-btn" @click.stop="showLearn = !showLearn">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        <span>学习</span>
        <svg class="ta-chevron" :class="{ open: showLearn }" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <Transition name="drop-enter">
        <div v-if="showLearn" class="ta-menu" @click.stop>
          <NuxtLink to="/words/daily" class="ta-menu-link" @click="showLearn = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            每日单词
          </NuxtLink>
          <NuxtLink to="/words/analysis" class="ta-menu-link" @click="showLearn = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            学习分析
          </NuxtLink>
          <NuxtLink to="/wordbooks" class="ta-menu-link" @click="showLearn = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            单词本
          </NuxtLink>
          <NuxtLink to="/reviews" class="ta-menu-link" @click="showLearn = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            复习本
          </NuxtLink>
          <NuxtLink to="/knowledge" class="ta-menu-link" @click="showLearn = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            知识要点
          </NuxtLink>
        </div>
      </Transition>
    </div>

    <!-- 添加下拉 -->
    <div class="ta-dropdown" ref="addRef">
      <button class="ta-btn" @click.stop="showAdd = !showAdd">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 5v14M5 12h14"/></svg>
        <span>添加</span>
        <svg class="ta-chevron" :class="{ open: showAdd }" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <Transition name="drop-enter">
        <div v-if="showAdd" class="ta-menu" @click.stop>
          <button @click="emit('importVideo'); showAdd = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
            导入视频
          </button>
          <template v-if="!disableLocalUpload">
          <button @click="emit('upload'); showAdd = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-1.5-.5"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            上传文件
          </button>
          <button @click="emit('batchUpload'); showAdd = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><polyline points="9 14 12 11 15 14"/></svg>
            批量上传
          </button>
          <button @click="emit('folderUpload'); showAdd = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            上传文件夹
          </button>
          </template>
          <button @click="emit('url'); showAdd = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            提取网页
          </button>
          <div class="ta-menu-sep"></div>
          <button @click="handleSync" :disabled="syncing">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" :class="{ 'spinning': syncing }"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
            {{ syncing ? '同步中…' : syncResult || '同步到云端' }}
          </button>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  importVideo: []
  upload: []
  url: []
  batchUpload: []
  folderUpload: []
}>()

const config = useRuntimeConfig()
const disableLocalUpload = computed(() => config.public.disableLocalUpload)
const showLearn = ref(false)
const showAdd = ref(false)
const syncing = ref(false)
const syncResult = ref('')

async function handleSync() {
  syncing.value = true
  syncResult.value = ''
  try {
    const res = await $fetch<{ totalInserted: number; totalUpdated: number; totalSkipped: number; ok: boolean; error?: string }>('/api/sync/to-turso', { method: 'POST' })
    if (res.ok) {
      const parts: string[] = []
      if (res.totalInserted > 0) parts.push(`+${res.totalInserted}`)
      if (res.totalUpdated > 0) parts.push(`~${res.totalUpdated}`)
      syncResult.value = parts.length > 0 ? `已同步 ${parts.join(' ')}` : '已是最新'
    }
  } catch (e: any) {
    syncResult.value = '同步失败'
  } finally {
    syncing.value = false
    showAdd.value = false
    setTimeout(() => { syncResult.value = '' }, 5000)
  }
}
const learnRef = ref<HTMLElement | null>(null)
const addRef = ref<HTMLElement | null>(null)

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

function onDocClick(e: MouseEvent) {
  if (showLearn.value && learnRef.value && !learnRef.value.contains(e.target as Node)) showLearn.value = false
  if (showAdd.value && addRef.value && !addRef.value.contains(e.target as Node)) showAdd.value = false
}
</script>

<style scoped>
.ta-group {
  display: flex;
  gap: 6px;
}

.ta-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 14px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  background: #ffffff;
  color: #6b6963;
  font-size: 13px;
  font-weight: 450;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
  white-space: nowrap;
}
.ta-btn:hover {
  color: #1a1a18;
  border-color: rgba(0, 0, 0, 0.14);
  background: #fafaf8;
}

.ta-menu-link {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 9px 12px;
  border: none; border-radius: 7px;
  background: transparent; color: #4a4a46;
  font-size: 13px; cursor: pointer;
  transition: background 0.12s; text-align: left;
  text-decoration: none; font-family: inherit;
}
.ta-menu-link:hover { background: rgba(0,0,0,0.04); color: #1a1a18; }

/* dropdown */
.ta-dropdown { position: relative; }
.ta-chevron {
  flex-shrink: 0;
  transition: transform 0.2s;
}
.ta-chevron.open { transform: rotate(180deg); }

.ta-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 140px;
  background: #ffffff;
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.08);
  padding: 6px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ta-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 12px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #4a4a46;
  font-size: 13px;
  font-family: 'DM Sans', sans-serif;
  cursor: pointer;
  transition: background 0.12s;
  text-align: left;
}
.ta-menu button:hover {
  background: rgba(0,0,0,0.04);
  color: #1a1a18;
}

.ta-menu-sep {
  border-top: 0.5px solid rgba(0,0,0,0.08);
  margin: 2px 4px;
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.drop-enter-enter-active, .drop-enter-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}
.drop-enter-enter-from, .drop-enter-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
