<template>
  <Transition name="mp-slide">
    <div v-if="visible" class="mini-player" @mouseenter="hovering = true" @mouseleave="hovering = false">
      <!-- 进度细线 -->
      <div class="mp-track" @click="onTrackClick($event)" ref="trackEl">
        <div class="mp-progress" :style="{ width: progressPct + '%' }"></div>
      </div>

      <div class="mp-controls">
        <!-- 播放/暂停 -->
        <button class="mp-btn-play" @click="togglePlay" :title="playing ? '暂停' : '播放'">
          <svg v-if="playing" width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
          </svg>
          <svg v-else width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6,3 20,12 6,21"/>
          </svg>
        </button>

        <!-- 时间（播放时淡入） -->
        <span class="mp-time" :class="{ show: playing || hovering }">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>

        <!-- 关闭 -->
        <button class="mp-btn-close" @click="$emit('close')" title="关闭">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- 隐藏播放器 -->
      <div
        v-if="isYoutube"
        ref="ytContainer"
        class="mp-yt-hidden"
        :id="ytContainerId"
      ></div>
      <audio
        v-else-if="isLocalAudio"
        ref="audioEl"
        class="mp-audio-hidden"
        :src="src"
        @timeupdate="onTimeUpdate"
        @loadedmetadata="onLoaded"
        @play="playing = true"
        @pause="playing = false"
        @ended="onEnded"
      ></audio>
    </div>
  </Transition>
</template>

<script setup lang="ts">
// ---- YT Player 类型 ----
interface YTPlayer {
  playVideo: () => void
  pauseVideo: () => void
  seekTo: (s: number, allowSeekAhead: boolean) => void
  getCurrentTime: () => number
  getDuration: () => number
  getPlayerState: () => number
  destroy: () => void
}

declare global {
  interface Window {
    YT?: { Player: new (id: string, config: any) => YTPlayer; loaded?: boolean }
    onYouTubeIframeAPIReady?: () => void
  }
}

// ---- Props ----
const props = defineProps<{
  src: string
  fileType?: string            // 'youtube' | 'video_file' | 'audio_file'
  visible: boolean
  startTime: number            // 段落 start（秒）
  endTime?: number             // 段落 end（秒）
}>()

const emit = defineEmits<{
  close: []
}>()

// ---- 类型判断 ----
const isYoutube = computed(() => props.fileType === 'youtube')
const isLocalAudio = computed(() => props.fileType === 'audio_file')

// ---- Refs ----
const ytContainer = ref<HTMLDivElement | null>(null)
const audioEl = ref<HTMLAudioElement | null>(null)
const trackEl = ref<HTMLDivElement | null>(null)

const ytContainerId = `mp-yt-${Math.random().toString(36).slice(2, 8)}`
const currentTime = ref(0)
const duration = ref(0)
const playing = ref(false)
const hovering = ref(false)

// ---- YouTube 播放器 ----
let ytPlayer: YTPlayer | null = null
let ytPollTimer: ReturnType<typeof setInterval> | null = null
let ytReady = false

function extractYouTubeId(url: string): string {
  const m = url.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)
  return m?.[1] || ''
}

function loadYTAPI(): Promise<void> {
  return new Promise((resolve) => {
    if (window.YT?.loaded) { resolve(); return }
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve() }
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      tag.async = true
      document.head.appendChild(tag)
    }
  })
}

async function initYT() {
  const container = document.getElementById(ytContainerId)
  if (!container) return
  const videoId = extractYouTubeId(props.src)
  if (!videoId) return
  await loadYTAPI()
  container.innerHTML = ''
  ytPlayer = new window.YT!.Player(ytContainerId, {
    videoId,
    height: '1',
    width: '1',
    playerVars: {
      controls: 0,
      disablekb: 1,
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
      origin: window.location.origin,
    },
    events: {
      onReady: () => {
        ytReady = true
        duration.value = ytPlayer?.getDuration() || 0
        ytPlayer?.seekTo(props.startTime, true)
        ytPlayer?.playVideo()
      },
      onStateChange: (e: any) => {
        const state = e.target.getPlayerState()
        if (state === 1) {
          playing.value = true
          // 立即检查一次：防短片段时间漏过轮询
          if (ytPlayer && props.endTime && ytPlayer.getCurrentTime() >= props.endTime) {
            ytPlayer.pauseVideo()
            return
          }
          startYTPoll()
        }
        else if (state === 2) { playing.value = false; stopYTPoll() }
        else if (state === 0) { playing.value = false; stopYTPoll() }
      },
    },
  })
}

function startYTPoll() {
  stopYTPoll()
  ytPollTimer = setInterval(() => {
    if (!ytPlayer || !ytReady) return
    const t = ytPlayer.getCurrentTime()
    currentTime.value = t
    // 到达段落 end 自动暂停
    if (props.endTime && t >= props.endTime) {
      ytPlayer.pauseVideo()
    }
  }, 200)
}

function stopYTPoll() {
  if (ytPollTimer) { clearInterval(ytPollTimer); ytPollTimer = null }
}

function destroyYT() {
  stopYTPoll()
  ytReady = false
  if (ytPlayer) { try { ytPlayer.destroy() } catch {}; ytPlayer = null }
}

// ---- 原生 audio ----
function onTimeUpdate(e: Event) {
  const el = e.target as HTMLAudioElement
  currentTime.value = el.currentTime
  if (props.endTime && el.currentTime >= props.endTime) {
    el.pause()
  }
}
function onLoaded(e: Event) {
  const el = e.target as HTMLAudioElement
  duration.value = el.duration || 0
  el.currentTime = props.startTime
  if (props.endTime && props.startTime >= props.endTime) return
  el.play().catch(() => {})
}
function onEnded() { playing.value = false }

// ---- 控制 ----
function togglePlay() {
  if (isYoutube.value && ytPlayer) {
    const state = ytPlayer.getPlayerState()
    if (state === 1) ytPlayer.pauseVideo()
    else { if (currentTime.value < props.startTime) ytPlayer.seekTo(props.startTime, true); ytPlayer.playVideo() }
  } else if (audioEl.value) {
    if (audioEl.value.paused) audioEl.value.play().catch(() => {})
    else audioEl.value.pause()
  }
}

function onTrackClick(e: MouseEvent) {
  if (!trackEl.value || duration.value <= 0) return
  const rect = trackEl.value.getBoundingClientRect()
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const t = pct * duration.value
  if (isYoutube.value && ytPlayer) ytPlayer.seekTo(t, true)
  else if (audioEl.value) audioEl.value.currentTime = t
}

const progressPct = computed(() => {
  if (duration.value <= 0) return 0
  return Math.min(100, (currentTime.value / duration.value) * 100)
})

function formatTime(s: number): string {
  if (!s || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

// ---- 监听 visible + startTime 变化 ----
watch(() => props.visible, async (v) => {
  if (v) {
    if (isYoutube.value) {
      destroyYT()
      await nextTick()
      initYT()
    }
  } else {
    if (isYoutube.value) destroyYT()
    else if (audioEl.value) { audioEl.value.pause(); audioEl.value.currentTime = 0 }
    playing.value = false
  }
})

watch(() => props.startTime, (t) => {
  if (t !== undefined && props.visible) {
    if (isYoutube.value && ytPlayer && ytReady) {
      ytPlayer.seekTo(t, true)
      // 防止 seek 后已超 end（极短段落）
      if (props.endTime && t >= props.endTime) return
      ytPlayer.playVideo()
    } else if (audioEl.value) {
      audioEl.value.currentTime = t
      if (props.endTime && t >= props.endTime) return
      audioEl.value.play().catch(() => {})
    }
  }
})

defineExpose({ playing })

onUnmounted(() => {
  if (isYoutube.value) destroyYT()
})
</script>

<style scoped>
.mini-player {
  position: relative;
  height: 28px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  background: transparent;
  border-top: 0.5px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
  user-select: none;
}

/* 进度细线 */
.mp-track {
  position: absolute;
  top: 0;
  left: 12px;
  right: 12px;
  height: 2px;
  background: #e8e6e0;
  cursor: pointer;
  z-index: 1;
}
.mp-progress {
  height: 100%;
  background: #3d3591;
  border-radius: 1px;
  transition: width 0.15s linear;
}

/* 控制区 */
.mp-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 16px;
  height: 100%;
  padding-top: 4px;
}
.mp-btn-play {
  width: 20px; height: 20px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: #a09e97;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.15s;
}
.mp-btn-play:hover { color: #3d3591; }
.mp-time {
  font-family: 'DM Mono', monospace;
  font-size: 11px;
  color: #c4c2ba;
  opacity: 0;
  transition: opacity 0.2s;
  flex-shrink: 0;
}
.mp-time.show { opacity: 1; }
.mp-btn-close {
  margin-left: auto;
  width: 18px; height: 18px;
  border-radius: 9px;
  border: none;
  background: transparent;
  color: #d0cec8;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: color 0.15s;
  flex-shrink: 0;
}
.mp-btn-close:hover { color: #dc2626; }

/* 隐藏播放器 */
.mp-yt-hidden,
.mp-audio-hidden {
  position: absolute;
  width: 1px; height: 1px;
  opacity: 0;
  pointer-events: none;
  overflow: hidden;
}

/* 过渡 */
.mp-slide-enter-active { transition: all 0.2s ease; }
.mp-slide-leave-active { transition: all 0.15s ease; }
.mp-slide-enter-from,
.mp-slide-leave-to { height: 0; opacity: 0; }
</style>
