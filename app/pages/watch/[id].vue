<template>
  <div class="watch-page" v-if="loaded">
    <!-- 顶部栏 -->
    <header class="watch-topbar">
      <button class="back-btn" @click="goBack">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        书架
      </button>

      <div class="watch-title-center">
        <span class="watch-doc-title">{{ title || '加载中…' }}</span>
      </div>

      <div class="watch-topbar-right">
        <button class="watch-learn-btn" :class="{ disabled: subtitlesLoading }" :disabled="subtitlesLoading" @click="goToLearn">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
          {{ subtitlesLoading ? '字幕加载中…' : '学习模式' }}
        </button>
      </div>
    </header>

    <!-- 主体 -->
    <div class="watch-body">
      <!-- 左侧：播放器 -->
      <div class="watch-player-col">
        <VideoPlayer
          ref="playerRef"
          :src="videoUrl"
          :file-type="source"
          :initial-time="initialTime"
          @timeupdate="onTimeUpdate"
          @durationchange="onDurationChange"
          @play="isPlaying = true"
          @pause="isPlaying = false"
          @ended="onEnded"
        />
      </div>

      <!-- 分隔线 -->
      <div class="panel-divider" @mousedown="startResize"></div>

      <!-- 右侧：字幕 + 精听 -->
      <div class="watch-sidebar" :style="{ width: sidebarWidth + 'px' }">
        <div v-if="subtitlesLoading" class="subs-loading">
          <div class="mini-spinner"></div>
          <p>正在后台加载字幕...</p>
        </div>
        <template v-else>
          <SubtitleList
            :cues="subtitles"
            :active-cue-id="activeCueId"
            :practice="practice"
            :loop-cue-id="loopCueId"
            @cue-click="handleCueClick"
            @toggle-save="handleToggleSave"
            @toggle-loop="handleToggleLoop"
          />
          <PracticeList
            :cues="subtitles"
            :practice="practice"
            :active-cue-id="activeCueId"
            :loop-cue-id="loopCueId"
            @cue-click="handleCueClick"
            @toggle-loop="handleToggleLoop"
            @mark-mastered="handleMarkMastered"
            @remove="handleRemovePractice"
          />
        </template>
      </div>
    </div>
  </div>

  <!-- 加载中 -->
  <div v-else class="watch-loading">
    <div class="mini-spinner"></div>
    <p>加载中...</p>
  </div>
</template>

<script setup lang="ts">
import type { SubtitleCue, SubtitlePractice } from '#shared/types'

const route = useRoute()
const router = useRouter()
const id = route.params.id as string

const loaded = ref(false)
const title = ref('')
const source = ref('')
const videoUrl = ref('')
const subtitles = ref<SubtitleCue[]>([])
const subtitlesLoading = ref(false)
const practice = ref<Record<string, SubtitlePractice>>({})
const isPlaying = ref(false)
const currentTime = ref(0)
const totalDuration = ref(0)
const activeCueId = ref<string | null>(null)
const loopCueId = ref<string | null>(null)
const initialTime = ref(0)
const sidebarWidth = ref(380)
const playerRef = ref<any>(null)

// 保存进度定时器
let progressTimer: ReturnType<typeof setInterval> | null = null

// 循环检测
let loopRaf: number | null = null

// ---- 加载数据 ----
onMounted(async () => {
  try {
    const data = await $fetch<any>(`/api/video/${id}`)
    title.value = data.title
    source.value = data.source
    subtitles.value = data.subtitles || []
    practice.value = data.practice || {}

    // 构建视频 URL
    if (data.videoMeta) {
      const meta = data.videoMeta
      videoUrl.value = meta.url
      totalDuration.value = meta.duration

      // 如果是本地文件
      if (meta.type === 'video_file' || meta.type === 'audio_file') {
        if (meta.url && !meta.url.startsWith('http')) {
          // 如果 URL 已包含 /api/file/ 前缀，直接使用；否则补全
          videoUrl.value = meta.url.startsWith('/api/file/') ? meta.url : `/api/file/${meta.url}`
        }
      }
    }

    // 恢复播放进度
    if (data.readingPosition?.videoTime) {
      initialTime.value = data.readingPosition.videoTime
    }

    // 处理路由参数中的跳转
    if (route.query.jump) {
      const jumpIdx = subtitles.value.findIndex(s => s.id === route.query.jump || s.index.toString() === route.query.jump)
      if (jumpIdx >= 0) {
        initialTime.value = subtitles.value[jumpIdx].start
      }
    } else if (route.query.time) {
      initialTime.value = parseFloat(route.query.time as string) || 0
    }

    loaded.value = true

    // 字幕为空 → 自动后台拉取
    if (!subtitles.value || subtitles.value.length === 0) {
      extractSubtitlesInBackground()
    }
  } catch (e: any) {
    alert('加载失败: ' + (e?.message || ''))
  }
})

async function extractSubtitlesInBackground() {
  subtitlesLoading.value = true
  try {
    // 触发后台提取（立即返回）
    await $fetch(`/api/video/extract-subtitles/${id}`, { method: 'POST' })

    // 轮询等待提取完成（每 2 秒检查一次）
    const poll = async () => {
      const data = await $fetch<any>(`/api/video/${id}`)
      if (data.subtitles?.length > 0) {
        title.value = data.title
        subtitles.value = data.subtitles
        practice.value = data.practice || {}
        subtitlesLoading.value = false
      } else {
        setTimeout(poll, 2000)
      }
    }
    setTimeout(poll, 2000)
  } catch (e: any) {
    console.warn('[watch] 后台字幕提取失败:', e?.message || '')
    subtitlesLoading.value = false
  }
}

// ---- 时间同步 ----
function onTimeUpdate(time: number) {
  currentTime.value = time

  // 查找当前字幕
  const cue = subtitles.value.find(c => time >= c.start && time < c.end)
  activeCueId.value = cue?.id || null

  // A-B 循环
  if (loopCueId.value) {
    const loopCue = subtitles.value.find(c => c.id === loopCueId.value)
    if (loopCue && time >= loopCue.end) {
      playerRef.value?.seek(loopCue.start)
    }
  }
}

function onDurationChange(duration: number) {
  totalDuration.value = duration
}

async function onEnded() {
  isPlaying.value = false
  loopCueId.value = null
  // 自动标记为已完成
  try { await $fetch('/api/text/complete', { method: 'POST', body: { id } }) } catch {}
}

// ---- 点击字幕 -> 跳转 ----
function handleCueClick(cue: SubtitleCue) {
  playerRef.value?.seek(cue.start)
  if (isPlaying.value) {
    // 如果正在播放，跳转后继续
  }
}

// ---- 循环控制 ----
function handleToggleLoop(cue: SubtitleCue) {
  if (loopCueId.value === cue.id) {
    loopCueId.value = null
  } else {
    loopCueId.value = cue.id
    playerRef.value?.seek(cue.start)
    playerRef.value?.togglePlay()
    // 确保在播放中
  }
}

// ---- 精听练习 ----
async function handleToggleSave(cue: SubtitleCue) {
  const existing = practice.value[cue.id]
  if (existing) {
    // 已保存 -> 移除
    delete practice.value[cue.id]
    await updatePractice(cue.id, { mastered: false })
    // 设置 repeatCount=0 表示移除
    practice.value = { ...practice.value }
  } else {
    // 保存
    practice.value = {
      ...practice.value,
      [cue.id]: { cueId: cue.id, repeatCount: 1, mastered: false, lastPracticed: new Date().toISOString() }
    }
    await updatePractice(cue.id, { repeatCount: 1, mastered: false })
  }
}

async function handleMarkMastered(cue: SubtitleCue) {
  const p = practice.value[cue.id]
  if (p) {
    p.mastered = true
    p.lastPracticed = new Date().toISOString()
    practice.value = { ...practice.value }
    await updatePractice(cue.id, { mastered: true })
  }
}

async function handleRemovePractice(cue: SubtitleCue) {
  delete practice.value[cue.id]
  practice.value = { ...practice.value }
  await updatePractice(cue.id, { mastered: false })
}

async function updatePractice(cueId: string, changes: Partial<SubtitlePractice>) {
  try {
    await $fetch('/api/video/practice', {
      method: 'PATCH',
      body: { id, cueId, practice: changes }
    })
  } catch { /* 静默失败 */ }
}

// ---- 进度保存 ----
async function saveProgress(time: number) {
  try {
    await $fetch('/api/text/update', {
      method: 'POST',
      body: {
        id,
        readingPosition: {
          paragraphId: activeCueId.value || '',
          videoTime: time,
          updatedAt: new Date().toISOString()
        }
      }
    })
  } catch { /* 静默 */ }
}

// 每 5 秒保存一次进度
watch(isPlaying, (playing) => {
  if (playing) {
    progressTimer = setInterval(() => {
      if (currentTime.value > 0) saveProgress(currentTime.value)
    }, 5000)
  } else {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null }
    // 暂停时保存一次
    if (currentTime.value > 0) saveProgress(currentTime.value)
  }
})

onUnmounted(() => {
  if (progressTimer) clearInterval(progressTimer)
  if (loopRaf) cancelAnimationFrame(loopRaf)
  // 最后保存一次进度
  if (currentTime.value > 0) saveProgress(currentTime.value)
})

// ---- 导航 ----
function goBack() {
  const folder = route.query.folder as string
  router.push(folder ? `/?folder=${folder}` : '/')
}

function goToLearn() {
  const folder = route.query.folder as string
  const folderParam = folder ? `&folder=${folder}` : ''
  router.push(`/read/${id}?from=watch${currentTime.value > 0 ? `&time=${currentTime.value}` : ''}${folderParam}`)
}

// ---- 面板拖拽 ----
let resizing = false
function startResize(e: MouseEvent) {
  resizing = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  const onMove = (ev: MouseEvent) => {
    if (!resizing) return
    const ww = window.innerWidth
    let rw = ww - ev.clientX
    if (rw < 300) rw = 300
    if (rw > 500) rw = 500
    sidebarWidth.value = rw
  }
  const onUp = () => {
    resizing = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
</script>

<style scoped>
.watch-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f7f6f3;
}

.watch-topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 20px; height: 50px;
  border-bottom: 0.5px solid rgba(0,0,0,0.08);
  flex-shrink: 0; gap: 16px;
  background: #ffffff;
}

.watch-title-center { flex: 1; text-align: center; overflow: hidden; }
.watch-doc-title { font-size: 13px; font-weight: 500; color: #1a1a18; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }

.watch-topbar-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

.watch-learn-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 14px;
  border: 0.5px solid rgba(61,53,145,0.25);
  border-radius: 8px;
  background: #edeafd;
  color: #3d3591;
  font-size: 12.5px;
  font-family: 'DM Sans', sans-serif;
  cursor: pointer;
  transition: background 0.12s;
  font-weight: 500;
}
.watch-learn-btn:hover { background: #ddd8fa; }
.watch-learn-btn.disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }

.watch-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.watch-player-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 12px;
  min-width: 0;
}

.watch-sidebar {
  display: flex;
  flex-direction: column;
  border-left: 0.5px solid rgba(0,0,0,0.08);
  background: #ffffff;
  flex-shrink: 0;
  overflow: hidden;
}

.watch-sidebar .subtitle-list { flex: 1; min-height: 0; }
.watch-sidebar .practice-list { flex-shrink: 0; }

.subs-loading {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; height: 200px; color: #a09e97; font-size: 13px;
}

.watch-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100vh;
  color: #a09e97;
  font-size: 14px;
}
</style>
