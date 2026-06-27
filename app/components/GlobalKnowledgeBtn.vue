<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="gkb-btn"
      :class="{ saved: isSaved }"
      :style="btnStyle"
      @click.stop="save"
    >
      <svg v-if="!isSaved" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      <span>{{ isSaved ? '已保存' : '知识要点' }}</span>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{
  sourceId?: string
  sourceTitle?: string
}>()

const visible = ref(false)
const isSaved = ref(false)
const x = ref(0)
const y = ref(0)
const selectedText = ref('')

const btnStyle = computed(() => {
  if (typeof window === 'undefined') return { display: 'none' }
  const w = window.innerWidth
  return {
    left: Math.max(10, Math.min(x.value - 35, w - 80)) + 'px',
    top: Math.max(4, y.value) + 'px',
  }
})

function onMouseUp() {
  setTimeout(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) { visible.value = false; return }

    // 排除段落正文区（已有「知」按钮）
    const node = sel.anchorNode
    if (node && (node.parentElement as HTMLElement)?.closest('.para-text, .para-block, .sel-toolbar, .cue-item')) {
      visible.value = false
      return
    }

    const text = sel.toString().trim()
    if (text.length < 2 || text.length > 500) { visible.value = false; return }

    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    visible.value = true
    x.value = rect.left + rect.width / 2
    y.value = rect.bottom + 6
    selectedText.value = text
    isSaved.value = false
  }, 10)
}

async function save() {
  if (!selectedText.value) return
  try {
    await $fetch('/api/knowledge/create', {
      method: 'POST',
      body: {
        content: selectedText.value,
        sourceId: props.sourceId || '',
        sourceTitle: props.sourceTitle || '',
        sourceType: 'selection',
        sourceContext: selectedText.value,
      },
    })
    isSaved.value = true
    setTimeout(() => { visible.value = false; isSaved.value = false }, 1500)
  } catch { /* 静默 */ }
}

onMounted(() => { document.addEventListener('mouseup', onMouseUp) })
onUnmounted(() => { document.removeEventListener('mouseup', onMouseUp) })
</script>

<style scoped>
.gkb-btn {
  position: fixed; z-index: 1500;
  display: flex; align-items: center; gap: 5px;
  padding: 5px 10px; border-radius: 16px;
  background: #3d3591; color: #fff;
  font-size: 11.5px; font-family: 'DM Sans', sans-serif;
  cursor: pointer; box-shadow: 0 2px 8px rgba(61,53,145,0.3);
  transition: background 0.15s; white-space: nowrap;
}
.gkb-btn:hover { background: #332d7a; }
.gkb-btn.saved { background: #059669; }
</style>
