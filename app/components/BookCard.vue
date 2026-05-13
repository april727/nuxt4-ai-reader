<template>
  <div
    class="doc-card"
    :class="coverTypeClass"
    :draggable="draggable"
    @click="$emit('open', id)"
    @dragstart="$emit('dragstart', $event)"
    @contextmenu.prevent="$emit('contextmenu', $event)"
  >
    <div class="doc-thumb">
      <svg v-if="isWeb" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25">
        <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
      <svg v-else-if="isPdf" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/>
      </svg>
      <svg v-else width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
      </svg>
      <span class="thumb-label">{{ sourceLabel }}</span>
    </div>
    <div class="doc-body">
      <p class="doc-title">{{ title }}</p>
      <div class="doc-meta">
        <span class="doc-reads">阅读 {{ readCount || 0 }} 次</span>
        <span class="doc-marks" v-if="markCount">· {{ markCount }} 标记</span>
      </div>
    </div>
    <div class="doc-hover-actions" @click.stop @contextmenu.stop>
      <button class="doc-action-btn" title="更多操作" @click.stop="$emit('contextmenu', $event)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  id: string; title: string; length: number; source: string; draggable?: boolean
  readCount?: number; lastReadAt?: string; markCount?: number
}>()

defineEmits<{ open: [id: string]; dragstart: [e: DragEvent]; contextmenu: [e: MouseEvent] }>()

const isPdf = computed(() => props.source?.toLowerCase().includes('.pdf') || props.source === 'upload')
const isWeb = computed(() => props.source?.startsWith('http'))
const coverTypeClass = computed(() => {
  if (isPdf.value) return 'thumb-pdf'
  if (isWeb.value) return 'thumb-web'
  return 'thumb-text'
})
const sourceLabel = computed(() => {
  if (props.source?.includes('.pdf')) return 'PDF'
  if (props.source?.startsWith('http')) return '网页'
  if (props.source === 'paste') return '粘贴'
  return '文本'
})
</script>

<style scoped>
.doc-card {
  border: 0.5px solid rgba(0,0,0,0.09);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  background: #ffffff;
  transition: border-color 0.15s, box-shadow 0.15s;
  position: relative;
  display: flex;
  flex-direction: column;
}
.doc-card:hover {
  border-color: rgba(0,0,0,0.18);
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
}
.doc-card:hover .doc-hover-actions { opacity: 1; }

.doc-thumb {
  height: 100px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

/* Pastel type colors */
.thumb-pdf .doc-thumb { background: #fce9e5; color: #b84b2e; }
.thumb-web .doc-thumb { background: #e2f4ec; color: #0e6b51; }
.thumb-text .doc-thumb { background: #edeafd; color: #4a40b0; }

.thumb-label {
  font-size: 11px;
  font-weight: 500;
  opacity: 0.7;
  font-family: 'DM Mono', monospace;
}

.doc-body { padding: 10px 12px 13px; }

.doc-title {
  font-size: 12.5px;
  font-weight: 400;
  color: #1a1a18;
  line-height: 1.5;
  margin-bottom: 7px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.doc-meta { display: flex; gap: 4px; font-size: 11px; color: #b0ae9f; }

.doc-hover-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  opacity: 0;
  transition: opacity 0.15s;
}

.doc-action-btn {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: rgba(255,255,255,0.9);
  border: 0.5px solid rgba(0,0,0,0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #6b6963;
  transition: background 0.12s;
}
.doc-action-btn:hover { background: #ffffff; color: #3d3591; }
</style>
