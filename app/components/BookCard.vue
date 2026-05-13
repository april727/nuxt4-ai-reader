<template>
  <div
    class="book-card"
    :draggable="draggable"
    @click="$emit('open', id)"
    @dragstart="$emit('dragstart', $event)"
    @contextmenu="$emit('contextmenu', $event)"
  >
    <div class="book-cover">
      <div class="book-icon-wrap">
        <svg v-if="isPdf" class="book-icon-svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><text x="7" y="17" font-size="4" fill="currentColor" stroke="none">PDF</text>
        </svg>
        <svg v-else class="book-icon-svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      </div>
      <span class="book-card-length">{{ formattedLength }}</span>
      <span v-if="sourceLabel" class="book-card-source">{{ sourceLabel }}</span>
    </div>
    <p class="book-card-title">{{ title }}</p>
    <p v-if="readCount" class="book-card-stats">阅读 {{ readCount }} 次 · {{ markCount || 0 }} 标记</p>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  id: string; title: string; length: number; source: string; draggable?: boolean
  readCount?: number; lastReadAt?: string; markCount?: number
}>()

defineEmits<{ open: [id: string]; dragstart: [e: DragEvent]; contextmenu: [e: MouseEvent] }>()

const isPdf = computed(() => props.source?.toLowerCase().includes('.pdf') || props.source === 'upload')
const formattedLength = computed(() => {
  if (props.length > 10000) return `${(props.length / 1000).toFixed(1)}k`
  if (props.length > 1000) return `${(props.length / 1000).toFixed(0)}k`
  return `${props.length}字`
})
const sourceLabel = computed(() => {
  if (props.source?.includes('.pdf')) return 'PDF'
  if (props.source?.startsWith('http')) return '网页'
  if (props.source === 'paste') return '粘贴'
  return ''
})
</script>

<style scoped>
.book-card {
  cursor: pointer; border-radius: 14px; padding: 16px 12px 12px;
  transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.25s;
  user-select: none; background: #ffffff; border: 1px solid #f1f5f9;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
}
.book-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 28px rgba(99,102,241,0.12);
  border-color: #e0e7ff;
}
.book-cover {
  position: relative;
  width: 100%; aspect-ratio: 1 / 1;
  background: linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #faf5ff 100%);
  border-radius: 12px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px;
  border: 1px solid #e8ecf1; transition: all 0.25s;
}
.book-card:hover .book-cover {
  background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 50%, #ede9fe 100%);
  border-color: #c7d2fe;
}
.book-icon-wrap { color: #6366f1; opacity: 0.7; transition: all 0.25s; }
.book-card:hover .book-icon-wrap { opacity: 1; transform: scale(1.08); }
.book-card-length { font-size: 11px; color: #94a3b8; font-weight: 500; }
.book-card-source { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: #eef2ff; color: #6366f1; font-weight: 500; }
.book-card-title {
  font-size: 0.82em; font-weight: 500; color: #334155; text-align: center;
  line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2;
  -webkit-box-orient: vertical; overflow: hidden; width: 100%;
}
.book-card-stats { font-size: 10px; color: #94a3b8; text-align: center; }
</style>
