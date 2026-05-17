<template>
  <div
    class="doc-card"
    :class="[coverTypeClass, { completed: !!completedAt }]"
    :draggable="draggable"
    @click="$emit('open', id)"
    @dragstart="$emit('dragstart', $event)"
    @contextmenu.prevent="$emit('contextmenu', $event)"
  >
    <div class="doc-thumb">
      <!-- YouTube 封面 -->
      <img
        v-if="isVideo && thumbnail"
        :src="thumbnail"
        class="thumb-cover"
        loading="lazy"
        alt=""
        @error="(e) => (e.target as HTMLImageElement).style.display = 'none'"
      />
      <!-- 网页 favicon -->
      <img
        v-else-if="isWeb"
        :src="faviconUrl"
        class="thumb-icon"
        loading="lazy"
        alt=""
        @error="(e) => (e.target as HTMLImageElement).style.display = 'none'"
      />
      <!-- 兜底 SVG 图标 -->
      <svg v-else-if="!thumbnail" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
        <template v-if="isPdf"><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></template>
      </svg>
      <span class="thumb-label">{{ sourceLabel }}</span>
    </div>
    <div class="doc-body">
      <p class="doc-title">{{ title }}</p>
      <div class="doc-meta">
        <span class="doc-meta-left">
          <span v-if="isVideo && duration" class="doc-duration">{{ formatDuration(duration) }}</span>
          <span v-else class="doc-reads">阅读 {{ readCount || 0 }} 次</span>
          <span class="doc-marks" v-if="markCount">· {{ markCount }} 标记</span>
          <span v-if="!isVideo && !markCount" class="doc-reads" style="display:none">&nbsp;</span>
        </span>
        <span v-if="completedAt" class="completed-label">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          已完成
        </span>
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
  readCount?: number; lastReadAt?: string; markCount?: number; duration?: number
  thumbnail?: string; completedAt?: string
}>()

defineEmits<{ open: [id: string]; dragstart: [e: DragEvent]; contextmenu: [e: MouseEvent] }>()

const videoSources = ['youtube', 'bilibili', 'video_file', 'audio_file']

const isVideo = computed(() => videoSources.includes(props.source))
const isPdf = computed(() => props.source?.toLowerCase().includes('.pdf') || props.source === 'upload')
const isWeb = computed(() => props.source?.startsWith('http'))
const coverTypeClass = computed(() => {
  if (isVideo.value) return 'thumb-video'
  if (isPdf.value) return 'thumb-pdf'
  if (isWeb.value) return 'thumb-web'
  return 'thumb-text'
})
const sourceLabel = computed(() => {
  if (isVideo.value) {
    if (props.source === 'youtube') return 'YouTube'
    if (props.source === 'bilibili') return 'B站'
    if (props.source === 'audio_file') return '音频'
    return '视频'
  }
  if (props.source?.includes('.pdf')) return 'PDF'
  if (props.source?.startsWith('http')) return '网页'
  if (props.source === 'paste') return '粘贴'
  return '文本'
})

const faviconUrl = computed(() => {
  if (!isWeb.value || !props.source?.startsWith('http')) return ''
  try {
    const u = new URL(props.source)
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`
  } catch { return '' }
})

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
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
  position: relative;
  overflow: hidden;
}

/* Pastel type colors */
.thumb-pdf .doc-thumb { background: #fce9e5; color: #b84b2e; }
.thumb-web .doc-thumb { background: #e2f4ec; color: #0e6b51; }
.thumb-text .doc-thumb { background: #edeafd; color: #4a40b0; }
.thumb-video .doc-thumb { background: #dbeafe; color: #1e40af; }

.thumb-label {
  font-size: 11px;
  font-weight: 500;
  opacity: 0.7;
  font-family: 'DM Mono', monospace;
}

.thumb-cover {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-icon {
  width: 28px;
  height: 28px;
  border-radius: 4px;
}

.doc-body { padding: 10px 12px 13px; display: flex; flex-direction: column; min-height: 52px; }

.doc-title {
  font-size: 12.5px;
  font-weight: 400;
  color: #1a1a18;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
}

.doc-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #b0ae9f;
  margin-top: auto;
}
.doc-meta-left {
  display: flex;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

.completed-label {
  color: #10b981;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  font-size: 10.5px;
}

/* 已完成卡片视觉 */
.doc-card.completed { opacity: 0.65; }
.doc-card.completed .doc-thumb { filter: saturate(0.6); }
.doc-card.completed .doc-title { color: #6b6963; }

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
