<template>
  <div class="video-player" :class="{ 'is-audio': isAudioMode, 'is-youtube': isYoutube }">
    <!-- YouTube IFrame API 动态播放器 -->
    <div v-if="isYoutube" ref="youtubeContainer" class="player-youtube"></div>

    <!-- 本地视频 -->
    <video
      v-if="isLocalFile && !isAudioMode"
      ref="videoRef"
      class="player-video"
      :src="src"
      @timeupdate="onNativeTimeUpdate"
      @loadedmetadata="onNativeLoadedMetadata"
      @play="onNativePlay"
      @pause="onNativePause"
      @ended="onNativeEnded"
      @click="togglePlay"
    />

    <!-- 本地音频 -->
    <div v-else-if="isAudioMode && isLocalFile" class="player-audio-cover" @click="togglePlay">
      <div class="audio-visualizer">
        <span v-for="i in 40" :key="i" class="audio-bar" :class="{ playing: isPlaying }" :style="{ animationDelay: `${i * 0.04}s` }"></span>
      </div>
      <div class="audio-label">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25">
          <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
        </svg>
        <span>{{ isPlaying ? '正在播放' : '点击播放' }}</span>
      </div>
      <audio ref="audioRef" :src="src" @timeupdate="onNativeTimeUpdate" @loadedmetadata="onNativeLoadedMetadata" @play="onNativePlay" @pause="onNativePause" @ended="onNativeEnded"></audio>
    </div>

    <!-- Bilibili 嵌入（保留静态 iframe，无字幕同步） -->
    <iframe
      v-else-if="isBilibili"
      ref="embedRef"
      class="player-embed"
      :src="embedUrl"
      frameborder="0"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen
    ></iframe>

    <!-- 控制栏：本地文件（全功能） -->
    <div v-if="isLocalFile" class="player-controls" @click.stop>
      <button class="ctrl-btn" @click="togglePlay" :title="isPlaying ? '暂停' : '播放'">
        <svg v-if="isPlaying" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
      </button>

      <input type="range" class="ctrl-seek" min="0" :max="duration || 1" :value="currentTime" @input="onSeek" step="0.1" />

      <span class="ctrl-time">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>

      <div class="ctrl-speeds">
        <button v-for="s in speeds" :key="s" class="ctrl-speed" :class="{ active: playbackRate === s }" @click="setSpeed(s)">{{ s }}×</button>
      </div>

      <button v-if="!isAudioMode" class="ctrl-btn" @click="toggleFullscreen" title="全屏">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
        </svg>
      </button>
    </div>

    <!-- 控制栏：YouTube 模式（仅附加倍速 + 时间显示，原生控件处理播放/拖拽） -->
    <div v-else-if="isYoutube" class="player-controls youtube-mini" @click.stop>
      <span class="ctrl-time">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
      <div class="ctrl-speeds">
        <button v-for="s in speeds" :key="s" class="ctrl-speed" :class="{ active: playbackRate === s }" @click="setSpeed(s)">{{ s }}×</button>
      </div>
    </div>

    <!-- 嵌入模式提示（仅 Bilibili） -->
    <div v-else-if="isBilibili" class="player-embed-hint">
      点击视频内播放按钮开始播放
    </div>
  </div>
</template>

<script setup lang="ts">
// ---- 类型 ----
interface YTPlayer {
  playVideo: () => void
  pauseVideo: () => void
  stopVideo: () => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  getCurrentTime: () => number
  getDuration: () => number
  getPlayerState: () => number
  setPlaybackRate: (rate: number) => void
  getPlaybackRate: () => number
  destroy: () => void
}

interface YTEvent { target: YTPlayer }
declare global {
  interface Window { YT?: { Player: new (id: string, config: any) => YTPlayer; loaded?: boolean }; onYouTubeIframeAPIReady?: () => void }
}

// ---- Props / Emits ----
const props = defineProps<{
  src: string
  fileType?: string
  poster?: string
  initialTime?: number
}>()

const emit = defineEmits<{
  timeupdate: [time: number]
  durationchange: [duration: number]
  play: []
  pause: []
  ended: []
}>()

// ---- DOM refs ----
const videoRef = ref<HTMLVideoElement | null>(null)
const audioRef = ref<HTMLAudioElement | null>(null)
const embedRef = ref<HTMLIFrameElement | null>(null)
const youtubeContainer = ref<HTMLDivElement | null>(null)

// ---- 状态 ----
const currentTime = ref(0)
const duration = ref(0)
const isPlaying = ref(false)
const playbackRate = ref(1)
const speeds = [0.75, 1, 1.25, 1.5, 2]

// ---- 类型判断 ----
const isLocalFile = computed(() => props.fileType === 'video_file' || props.fileType === 'audio_file')
const isAudioMode = computed(() => props.fileType === 'audio_file')
const isYoutube = computed(() => props.fileType === 'youtube')
const isBilibili = computed(() => props.fileType === 'bilibili')

// ---- Bilibili embed URL ----
const embedUrl = computed(() => {
  if (isBilibili.value) {
    const match = props.src.match(/video\/(BV[a-zA-Z0-9]+)/)
    const bv = match?.[1] || ''
    return `https://player.bilibili.com/player.html?bvid=${bv}&autoplay=0`
  }
  return ''
})

// ============================================================
//  YouTube IFrame API 播放器
// ============================================================

let ytPlayer: YTPlayer | null = null
let ytPollTimer: ReturnType<typeof setInterval> | null = null
let ytReady = false

/** 提取 YouTube 视频 ID */
function getYouTubeId(url: string): string {
  const m = url.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)
  return m?.[1] || ''
}

/** 加载 YT IFrame API */
function loadYTAPI(): Promise<void> {
  return new Promise((resolve) => {
    if (window.YT?.loaded) { resolve(); return }
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve()
    }
    // 防止重复加载
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      tag.async = true
      document.head.appendChild(tag)
    }
  })
}

/** 创建 YouTube 播放器 */
async function initYouTubePlayer() {
  if (!youtubeContainer.value) return
  const videoId = getYouTubeId(props.src)
  if (!videoId) return

  await loadYTAPI()

  // 清空容器
  youtubeContainer.value.innerHTML = ''

  ytPlayer = new window.YT!.Player(youtubeContainer.value.id, {
    videoId,
    height: '100%',
    width: '100%',
    playerVars: {
      controls: 1,
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
      origin: window.location.origin,
    },
    events: {
      onReady: onYTReady,
      onStateChange: onYTStateChange,
    },
  })
}

function onYTReady() {
  ytReady = true
  // 设置初始时间
  if (props.initialTime && props.initialTime > 0) {
    ytPlayer?.seekTo(props.initialTime, true)
  }
  // 获取时长
  const d = ytPlayer?.getDuration() || 0
  duration.value = d
  emit('durationchange', d)

  // 开始轮询时间
  startYTPoll()
}

function onYTStateChange(e: YTEvent) {
  const state = e.target.getPlayerState()
  // YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
  if (state === 1) {
    isPlaying.value = true
    emit('play')
    startYTPoll()
  } else if (state === 2) {
    isPlaying.value = false
    emit('pause')
    stopYTPoll()
    // 暂停时确保最后一次时间被记录
    if (ytPlayer) {
      currentTime.value = ytPlayer.getCurrentTime()
      emit('timeupdate', currentTime.value)
    }
  } else if (state === 0) {
    isPlaying.value = false
    emit('ended')
    stopYTPoll()
  }
}

function startYTPoll() {
  stopYTPoll()
  ytPollTimer = setInterval(() => {
    if (!ytPlayer || !ytReady) return
    const t = ytPlayer.getCurrentTime()
    currentTime.value = t
    emit('timeupdate', t)
  }, 200)
}

function stopYTPoll() {
  if (ytPollTimer) { clearInterval(ytPollTimer); ytPollTimer = null }
}

function destroyYTPlayer() {
  stopYTPoll()
  ytReady = false
  if (ytPlayer) {
    try { ytPlayer.destroy() } catch {}
    ytPlayer = null
  }
}

// ---- 初始化/销毁 YouTube 播放器 ----
// 给容器一个稳定的 ID
const YT_CONTAINER_ID = 'youtube-player-instance'

watch(() => props.src, () => {
  if (isYoutube.value) {
    destroyYTPlayer()
    initYouTubePlayer()
  }
})

onMounted(() => {
  if (youtubeContainer.value) youtubeContainer.value.id = YT_CONTAINER_ID
  if (isYoutube.value) initYouTubePlayer()
})

onUnmounted(() => {
  destroyYTPlayer()
})

// ============================================================
//  原生 <video>/<audio> 事件处理
// ============================================================

function getMedia(): HTMLVideoElement | HTMLAudioElement | null {
  return videoRef.value || audioRef.value
}

function onNativeTimeUpdate(e: Event) {
  const media = e.target as HTMLVideoElement | HTMLAudioElement
  currentTime.value = media.currentTime
  emit('timeupdate', media.currentTime)
}

function onNativeLoadedMetadata(e: Event) {
  const media = e.target as HTMLVideoElement | HTMLAudioElement
  duration.value = media.duration || 0
  emit('durationchange', media.duration || 0)
  if (props.initialTime && props.initialTime > 0) {
    media.currentTime = props.initialTime
  }
}

function onNativePlay() { isPlaying.value = true; emit('play') }
function onNativePause() { isPlaying.value = false; emit('pause') }
function onNativeEnded() { isPlaying.value = false; emit('ended') }

// ============================================================
//  统一控制接口（本地 / YouTube 共用）
// ============================================================

function togglePlay() {
  if (isYoutube.value && ytPlayer) {
    const state = ytPlayer.getPlayerState()
    if (state === 1) ytPlayer.pauseVideo()
    else ytPlayer.playVideo()
  } else {
    const media = getMedia()
    if (!media) return
    if (media.paused) media.play().catch(() => {})
    else media.pause()
  }
}

function seek(time: number) {
  if (isYoutube.value && ytPlayer) {
    ytPlayer.seekTo(time, true)
  } else {
    const media = getMedia()
    if (media) media.currentTime = time
  }
}

function setSpeed(rate: number) {
  playbackRate.value = rate
  if (isYoutube.value && ytPlayer) {
    ytPlayer.setPlaybackRate(rate)
  } else {
    const media = getMedia()
    if (media) media.playbackRate = rate
  }
}

function toggleFullscreen() {
  if (isYoutube.value) {
    // YouTube 播放器全屏
    const el = youtubeContainer.value?.querySelector('iframe') || youtubeContainer.value
    if (el) {
      if (document.fullscreenElement) document.exitFullscreen()
      else el.requestFullscreen?.()
    }
  } else {
    const el = videoRef.value
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen()
    else el.requestFullscreen()
  }
}

function onSeek(e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value)
  seek(val)
}

function formatTime(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// ---- 监听初始时间变化 ----
watch(() => props.initialTime, (t) => {
  if (t && t > 0) seek(t)
})

// ---- 暴露给父组件 ----
defineExpose({ togglePlay, seek, setSpeed, currentTime, duration })
</script>

<style scoped>
.video-player {
  display: flex;
  flex-direction: column;
  background: #1a1a18;
  border-radius: 10px;
  overflow: hidden;
  position: relative;
  height: 100%;
}

.player-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  cursor: pointer;
  flex: 1;
}

.player-youtube {
  width: 100%;
  flex: 1;
  min-height: 0;
  position: relative;
}
.player-youtube :deep(iframe) {
  width: 100%;
  height: 100%;
}

.player-audio-cover {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  cursor: pointer;
  min-height: 180px;
}

.audio-visualizer {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 60px;
}

.audio-bar {
  width: 4px;
  background: #4a40b0;
  border-radius: 2px;
  opacity: 0.3;
  height: 20px;
}
.audio-bar.playing {
  animation: audioBounce 0.6s ease-in-out infinite alternate;
  opacity: 0.6;
}

@keyframes audioBounce {
  0% { height: 12px; }
  100% { height: 56px; }
}

.audio-label {
  color: #a09e97;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.player-embed {
  width: 100%;
  flex: 1;
  min-height: 0;
}

.player-embed-hint {
  padding: 10px;
  text-align: center;
  color: #a09e97;
  font-size: 12px;
}

.player-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: #111110;
  flex-shrink: 0;
}

.ctrl-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: #d0cec8;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  flex-shrink: 0;
}
.ctrl-btn:hover { background: rgba(255,255,255,0.1); color: #ffffff; }

.ctrl-seek {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: #3a3a38;
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  min-width: 60px;
}
.ctrl-seek::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #3d3591;
  cursor: pointer;
}

.ctrl-time {
  font-family: 'DM Mono', monospace;
  font-size: 11px;
  color: #a09e97;
  white-space: nowrap;
  flex-shrink: 0;
}

.ctrl-speeds {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.ctrl-speed {
  padding: 3px 8px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: #a09e97;
  font-size: 11px;
  font-family: 'DM Sans', sans-serif;
  cursor: pointer;
  transition: all 0.12s;
  font-weight: 500;
}
.ctrl-speed:hover { color: #d0cec8; }
.ctrl-speed.active {
  background: #3d3591;
  color: #ffffff;
}
</style>
