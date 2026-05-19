<template>
  <article
    class="doc-card"
    :class="[coverTypeClass, { completed: !!completedAt }]"
    :draggable="draggable"
    @click="$emit('open', id)"
    @dragstart="$emit('dragstart', $event)"
    @contextmenu.prevent="$emit('contextmenu', $event)"
  >
    <div class="doc-thumb">
      <img
        v-if="isVideo && thumbnail"
        :src="thumbnail"
        class="thumb-cover"
        alt=""
        draggable="false"
        @error="(e) => (e.target as HTMLImageElement).style.display = 'none'"
      />
      <img
        v-else-if="isWeb"
        :src="faviconUrl"
        class="thumb-icon"
        alt=""
        draggable="false"
        @error="(e) => (e.target as HTMLImageElement).style.display = 'none'"
      />
      <svg
        v-else
        class="thumb-fallback"
        width="28" height="28"
        viewBox="0 0 24 24"
        fill="none" stroke="currentColor"
        stroke-width="1.3"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <template v-if="isPdf"><line x1="9" y1="13" x2="16" y2="13"/><line x1="9" y1="17" x2="14" y2="17"/></template>
        <template v-if="isText">
          <line x1="9" y1="12" x2="16" y2="12"/><line x1="9" y1="16" x2="16" y2="16"/>
        </template>
      </svg>
      <span v-if="!isVideo || !thumbnail" class="thumb-label">{{ sourceLabel }}</span>
    </div>
    <div class="doc-body">
      <h3 class="doc-title">{{ title }}</h3>
      <div class="doc-meta">
        <span class="doc-meta-left">
          <span v-if="isVideo && duration" class="doc-duration">{{ formatDuration(duration) }}</span>
          <span v-else class="doc-reads">{{ readCount ? `阅读 ${readCount} 次` : '尚未阅读' }}</span>
          <span v-if="markCount" class="doc-sep">·</span>
          <span v-if="markCount" class="doc-marks">{{ markCount }} 标记</span>
        </span>
        <span v-if="completedAt" class="completed-label">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          完成
        </span>
      </div>
    </div>
    <!-- 三点菜单按钮 -->
    <button
      class="doc-menu-btn"
      @click.stop="$emit('menu', $event)"
      title="更多操作"
    >
      <svg width="3" height="13" viewBox="0 0 3 13" fill="currentColor">
        <circle cx="1.5" cy="1.5" r="1.5"/><circle cx="1.5" cy="6.5" r="1.5"/><circle cx="1.5" cy="11.5" r="1.5"/>
      </svg>
    </button>
    <div class="doc-hover-glow"></div>
  </article>
</template>

<script setup lang="ts">
const props = defineProps<{
  id: string; title: string; length: number; source: string; draggable?: boolean
  readCount?: number; lastReadAt?: string; markCount?: number; duration?: number
  thumbnail?: string; completedAt?: string
}>()

defineEmits<{ open: [id: string]; dragstart: [e: DragEvent]; contextmenu: [e: MouseEvent]; menu: [e: MouseEvent] }>()

const videoSources = ['youtube', 'bilibili', 'video_file', 'audio_file']

const isVideo = computed(() => videoSources.includes(props.source))
const isPdf = computed(() => props.source?.toLowerCase().includes('.pdf') || props.source === 'upload')
const isWeb = computed(() => props.source?.startsWith('http'))
const isText = computed(() => !isVideo.value && !isPdf.value && !isWeb.value)
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
.doc-card img {
  -webkit-user-drag: none;
  user-select: none;
}
.doc-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  overflow: hidden;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.06);
  cursor: pointer;
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 0.25s ease,
              border-color 0.25s ease;
}
.doc-card:hover {
  transform: translateY(-3px);
  border-color: rgba(0, 0, 0, 0.1);
  box-shadow:
    0 8px 30px rgba(0, 0, 0, 0.06),
    0 2px 8px rgba(0, 0, 0, 0.04);
}
.doc-card:hover .doc-hover-glow {
  opacity: 1;
}
.doc-card.completed {
  opacity: 0.55;
  filter: grayscale(0.3);
}
.doc-card.completed .doc-thumb {
  filter: saturate(0.4) brightness(0.85);
}
.doc-card.completed .doc-title {
  color: #8a877c;
}

/* ── 三点菜单按钮 ── */
.doc-menu-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 5;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.85);
  color: #8a877c;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s, background 0.15s;
}
.doc-card:hover .doc-menu-btn {
  opacity: 1;
}
.doc-menu-btn:hover {
  background: #ffffff;
  color: #3d3591;
}

/* subtle glow on hover */
.doc-hover-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: 14px;
  opacity: 0;
  transition: opacity 0.3s;
  box-shadow: inset 0 1px 0 rgba(61, 53, 145, 0.06);
}

/* ── Thumbnail ── */
.doc-thumb {
  aspect-ratio: 16 / 9;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  position: relative;
  overflow: hidden;
}

.thumb-pdf .doc-thumb { background: #fdf2ed; color: #b85a3c; }
.thumb-web .doc-thumb { background: #ebf7f1; color: #187a52; }
.thumb-text .doc-thumb { background: #edeafd; color: #4a40b0; }
.thumb-video .doc-thumb { background: #dbeafe; color: #1e40af; }

.thumb-label {
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.04em;
  opacity: 0.65;
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
  width: 30px;
  height: 30px;
  border-radius: 6px;
}

.thumb-fallback {
  flex-shrink: 0;
  opacity: 0.65;
}
/* 视频卡片兜底图标加大 */
.thumb-video .thumb-fallback {
  width: 36px;
  height: 36px;
}

/* ── Body ── */
.doc-body {
  padding: 12px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.doc-title {
  font-family: 'Lora', Georgia, serif;
  font-size: 13.5px;
  font-weight: 450;
  color: #1a1a18;
  line-height: 1.45;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.doc-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #a09e97;
}
.doc-meta-left {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  flex-wrap: wrap;
}
.doc-sep {
  color: #d4d1c8;
}
.doc-duration {
  font-family: 'DM Mono', monospace;
  color: #8a877c;
}

.completed-label {
  display: flex;
  align-items: center;
  gap: 3px;
  color: #10b981;
  font-weight: 500;
  font-size: 10.5px;
  flex-shrink: 0;
}
</style>
