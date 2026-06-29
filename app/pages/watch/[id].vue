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
        <div class="mode-switcher">
          <button :class="{ active: viewMode === 'video' }" @click="viewMode = 'video'" title="视频模式">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          </button>
          <button :class="{ active: viewMode === 'audio' }" @click="viewMode = 'audio'" title="纯听模式">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
          </button>
        </div>
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
      <!-- 播放器：始终挂载，视频模式可见，音频/笔记模式隐藏 -->
      <div v-show="viewMode === 'video'" class="watch-player-col" :class="{ 'expanded': !showSubtitles || !subtitles.length }">
        <VideoPlayer
          ref="playerRef"
          :src="videoUrl"
          :file-type="source"
          :initial-time="initialTime"
          @timeupdate="onTimeUpdate"
          @durationchange="onDurationChange"
          @play="isPlaying = true; audioPlaying = true"
          @pause="isPlaying = false; audioPlaying = false"
          @ended="onEnded"
        />
      </div>

      <!-- ── 默认：视频 + 字幕 ── -->
      <template v-if="viewMode === 'video'">
        <div class="panel-divider" @mousedown="startResize"></div>
        <div class="watch-sidebar" :class="{ hidden: !showSubtitles }" :style="{ width: showSubtitles ? sidebarWidth + 'px' : '0px' }">
          <!-- 字幕推拉按钮 -->
          <div class="subs-toggle" @click="toggleSubtitles" :title="showSubtitles ? '隐藏字幕' : '显示字幕'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline v-if="showSubtitles" points="15 18 9 12 15 6"/>
              <polyline v-else points="9 18 15 12 9 6"/>
            </svg>
          </div>
          <WatchSubtitles
            v-if="showSubtitles && (subtitles.length || subtitlesLoading)"
            :cues="subtitles" :active-cue-id="activeCueId" :practice="practice"
            :loop-cue-id="loopCueId" :loop-end-cue-id="loopEndCueId" :loading="subtitlesLoading"
            @cue-click="handleCueClick" @toggle-save="handleToggleSave"
            @toggle-loop="handleToggleLoop" @mark-mastered="handleMarkMastered"
            @remove-practice="handleRemovePractice" @reupload="triggerReupload"
          />
          <div v-else class="sub-upload-area">
            <div class="sub-upload-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#a09e97" stroke-width="1.2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
            </div>
            <p class="sub-upload-hint">暂无字幕</p>
            <p class="sub-upload-desc">尝试自动获取，或手动上传 SRT / VTT 文件</p>
            <div class="sub-upload-actions">
              <button
                class="sub-upload-btn"
                :disabled="subtitlesLoading || subUploading"
                @click="extractSubtitlesInBackground"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                {{ subtitlesLoading ? '获取中...' : '获取字幕' }}
              </button>
              <label class="sub-upload-btn">
                <input type="file" accept=".srt,.vtt" @change="handleSubUpload" :disabled="subUploading" hidden />
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                上传字幕
              </label>
            </div>
            <div v-if="subUploading || subtitlesLoading" class="sub-upload-loading">
              <div class="mini-spinner"></div>
              <span>{{ subUploading ? '正在解析字幕…' : '正在获取字幕…' }}</span>
            </div>
            <p v-if="subUploadError" class="sub-upload-error">{{ subUploadError }}</p>
          </div>
          <SubtitleChat
            v-if="subtitles.length"
            :cues="subtitles" :active-cue-id="activeCueId" :title="title"
          />
        </div>
      </template>

      <!-- ── 音频模式：控制条 + 字幕 + 可选笔记 ── -->
      <div v-else class="audio-mode-wrap">
        <AudioControlBar
          :current="currentTime" :duration="totalDuration"
          :playing="audioPlaying" :volume="audioVolume"
          @toggle="toggleAudioPlay" @seek="seekAudio" @set-volume="setAudioVolume"
        />
        <div class="audio-layout">
          <!-- 字幕区：笔记隐藏时占满，显示时在左侧 -->
          <div class="audio-subtitles-col" :class="{ 'with-notes': showNotes }">
            <WatchSubtitles
              v-if="showSubtitles && (subtitles.length || subtitlesLoading)"
              :cues="subtitles" :active-cue-id="activeCueId" :practice="practice"
              :loop-cue-id="loopCueId" :loop-end-cue-id="loopEndCueId" :loading="subtitlesLoading"
              @cue-click="handleCueClick" @toggle-save="handleToggleSave"
              @toggle-loop="handleToggleLoop" @mark-mastered="handleMarkMastered"
              @remove-practice="handleRemovePractice" @reupload="triggerReupload"
            />
            <div v-else class="sub-upload-area">
              <div class="sub-upload-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#a09e97" stroke-width="1.2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
              </div>
              <p class="sub-upload-hint">自动字幕下载失败</p>
              <p class="sub-upload-desc">该视频未能自动获取字幕，您可以手动上传 SRT 或 VTT 字幕文件</p>
              <label class="sub-upload-btn">
                <input type="file" accept=".srt,.vtt" @change="handleSubUpload" hidden />
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                上传字幕文件
              </label>
              <div v-if="subUploading" class="sub-upload-loading">
                <div class="mini-spinner"></div>
                <span>正在解析字幕…</span>
              </div>
              <p v-if="subUploadError" class="sub-upload-error">{{ subUploadError }}</p>
            </div>
            <SubtitleChat
              v-if="subtitles.length"
              :cues="subtitles" :active-cue-id="activeCueId" :title="title"
            />
          </div>

          <!-- 笔记面板 -->
          <div v-if="showNotes" class="panel-divider" @mousedown="startNotesResize"></div>
          <div class="notes-panel" :class="{ hidden: !showNotes }" :style="{ width: showNotes ? notesSidebarWidth + 'px' : '0px' }">
            <div class="notes-toggle" @click="showNotes = !showNotes" :title="showNotes ? '隐藏笔记' : '展开笔记'">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline v-if="showNotes" points="15 18 9 12 15 6"/>
                <polyline v-else points="9 18 15 12 9 6"/>
              </svg>
            </div>
            <div class="notes-header" :class="{ collapsed: !showNotes }">
              <span v-if="showNotes" class="notes-label">笔记</span>
              <div v-if="showNotes" class="notes-header-right">
                <button
                  class="notes-mode-btn"
                  :class="{ active: notesMode === 'edit' }"
                  @click="notesMode = 'edit'"
                >编辑</button>
                <button
                  class="notes-mode-btn"
                  :class="{ active: notesMode === 'preview' }"
                  @click="notesMode = 'preview'"
                >预览</button>
                <button class="notes-save-btn" @click="notesDirty = true; saveNotes()">保存</button>
              </div>
            </div>
            <template v-if="showNotes">
              <textarea
                v-if="notesMode === 'edit'"
                v-model="notes"
                class="notes-textarea"
                placeholder="边听边记…（支持 Markdown）"
                @input="markNotesDirty"
              ></textarea>
              <div v-else class="notes-preview">
                <MarkdownRenderer v-if="notes.trim()" :content="notes" />
                <p v-else class="notes-preview-empty">暂无笔记</p>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 加载中 -->
  <div v-else class="watch-loading">
    <div class="mini-spinner"></div>
    <p>加载中...</p>
  </div>

  <!-- 隐藏的文件选择器：用于替换字幕 -->
  <input ref="reuploadInputRef" type="file" accept=".srt,.vtt" class="file-input-hidden" @change="handleReupload" />

  <!-- 全局知识要点按钮 -->
  <GlobalKnowledgeBtn :source-id="id" :source-title="title" />

</template>

<script setup lang="ts">
import type { SubtitleCue, SubtitlePractice } from '#shared/types'
import MarkdownRenderer from '~/components/MarkdownRenderer.vue'
import GlobalKnowledgeBtn from '~/components/GlobalKnowledgeBtn.vue'

const route = useRoute()
const router = useRouter()
const id = route.params.id as string

const loaded = ref(false)
const title = ref('')
const source = ref('')
const videoUrl = ref('')
const subtitles = ref<SubtitleCue[]>([])
const subtitlesLoading = ref(false)
const showSubtitles = ref(loadSubPref())
function loadSubPref(): boolean { try { return localStorage.getItem('subtitles-visible') !== 'false' } catch { return true } }
function toggleSubtitles() { showSubtitles.value = !showSubtitles.value; try { localStorage.setItem('subtitles-visible', String(showSubtitles.value)) } catch {} }
const subUploading = ref(false)
const subUploadError = ref('')
const reuploadInputRef = ref<HTMLInputElement | null>(null)
const practice = ref<Record<string, SubtitlePractice>>({})
const isPlaying = ref(false)
const currentTime = ref(0)
const totalDuration = ref(0)
const activeCueId = ref<string | null>(null)
const loopCueId = ref<string | null>(null)
const loopEndCueId = ref<string | null>(null)
const initialTime = ref(0)
const sidebarWidth = ref(380)
const playerRef = ref<any>(null)

// ── 显示模式 ──
const viewMode = ref<'video' | 'audio'>('video')
const showNotes = ref(true)
const audioPlaying = ref(false)
const audioVolume = ref(80)
const notes = ref('')
const notesMode = ref<'edit' | 'preview'>('edit')
const notesSidebarWidth = ref(340)

// ── 音频控制 ──
function toggleAudioPlay() {
  audioPlaying.value = !audioPlaying.value
  playerRef.value?.togglePlay()
}
function seekAudio(time: number) { playerRef.value?.seek(time) }
function setAudioVolume(v: number) {
  audioVolume.value = v
  // 通过 VideoPlayer 设置音量（如果支持）
  try { playerRef.value?.setVolume?.(v / 100) } catch {}
}

// ── 笔记 ──
let notesDirty = false
let notesSaveTimer: ReturnType<typeof setTimeout> | null = null

async function saveNotes() {
  if (!notesDirty) return
  try {
    await $fetch('/api/text/notes', { method: 'POST', body: { id, notes: notes.value } })
    notesDirty = false
  } catch { /* 静默 */ }
}

function markNotesDirty() {
  notesDirty = true
  if (notesSaveTimer) clearTimeout(notesSaveTimer)
  notesSaveTimer = setTimeout(() => saveNotes(), 3000)
}

async function loadNotes() {
  try {
    const data = await $fetch<any>(`/api/text/${id}`)
    if (data.notes) notes.value = data.notes
  } catch {}
}

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
    loadNotes()

    // 字幕为空时不再自动获取，用户可手动点击「获取字幕」或「上传字幕」
  } catch (e: any) {
    alert('加载失败: ' + (e?.message || ''))
  }
})

const MAX_POLL_ATTEMPTS = 15 // 最多轮询 15 次（约 30 秒），避免永久等待
const POLL_INTERVAL = 2000

async function extractSubtitlesInBackground() {
  subtitlesLoading.value = true
  let pollAttempts = 0

  try {
    // 触发后台提取（立即返回）
    const extractRes = await $fetch<{ status: string }>(`/api/video/extract-subtitles/${id}`, { method: 'POST' })

    // 如果服务端明确失败（如 yt-dlp 未安装），直接停止
    if (extractRes.status === 'done') {
      // 已有字幕，重载数据
      const data = await $fetch<any>(`/api/video/${id}`)
      if (data.subtitles?.length > 0) {
        title.value = data.title
        subtitles.value = data.subtitles
        practice.value = data.practice || {}
      }
      subtitlesLoading.value = false
      return
    }

    // 轮询等待提取完成（最多 MAX_POLL_ATTEMPTS 次）
    const poll = async () => {
      pollAttempts++
      try {
        const data = await $fetch<any>(`/api/video/${id}`)
        if (data.subtitles?.length > 0) {
          title.value = data.title
          subtitles.value = data.subtitles
          practice.value = data.practice || {}
          subtitlesLoading.value = false
        } else if (pollAttempts >= MAX_POLL_ATTEMPTS) {
          // 超时：停止轮询，显示手动上传区域
          console.warn('[watch] 字幕自动提取超时，请手动上传')
          subtitlesLoading.value = false
        } else {
          setTimeout(poll, POLL_INTERVAL)
        }
      } catch {
        // 单次请求失败不终止，继续轮询
        if (pollAttempts >= MAX_POLL_ATTEMPTS) {
          subtitlesLoading.value = false
        } else {
          setTimeout(poll, POLL_INTERVAL)
        }
      }
    }
    setTimeout(poll, POLL_INTERVAL)
  } catch (e: any) {
    console.warn('[watch] 后台字幕提取启动失败:', e?.message || '')
    subtitlesLoading.value = false
  }
}

// ---- 手动上传字幕 ----
async function handleSubUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  subUploading.value = true
  subUploadError.value = ''

  try {
    // 客户端预检
    if (file.size > 5 * 1024 * 1024) {
      subUploadError.value = '文件过大（超过 5MB），请确认是否为有效字幕文件'
      return
    }
    if (file.size === 0) {
      subUploadError.value = '文件为空，请重新选择'
      return
    }

    const fd = new FormData()
    fd.append('file', file)
    const parsed = await $fetch<{ subtitles: SubtitleCue[], text: string, duration: number }>(
      '/api/video/subtitle/upload', { method: 'POST', body: fd }
    )
    await $fetch(`/api/video/${id}/attach-subtitles`, {
      method: 'POST', body: { subtitles: parsed.subtitles },
    })
    subtitles.value = parsed.subtitles
    // 只在标题为空或是原始 video ID 时才用文件名覆盖，已有标题则保留
    if (!title.value || /^[A-Za-z0-9_-]{11}$/.test(title.value)) {
      title.value = file.name.replace(/\.(srt|vtt)$/i, '')
    }
    subUploadError.value = ''
  } catch (e: any) {
    // 根据错误类型给出不同的提示
    const msg = e?.message || e?.statusMessage || ''
    if (msg.includes('编码') || msg.includes('encoding')) {
      subUploadError.value = '文件编码不兼容，请用 UTF-8 重新保存字幕文件后再试'
    } else if (msg.includes('格式') || msg.includes('format') || msg.includes('SRT') || msg.includes('VTT')) {
      subUploadError.value = msg
    } else if (msg.includes('解析') || msg.includes('时间戳') || msg.includes('parse')) {
      subUploadError.value = '字幕解析失败：文件格式可能不正确，请检查是否包含有效的时间戳'
    } else if (e?.statusCode === 413 || msg.includes('too large') || msg.includes('过大')) {
      subUploadError.value = '文件过大，请确认是否为有效字幕文件'
    } else {
      subUploadError.value = '上传失败: ' + (msg || '网络错误，请重试')
    }
  } finally {
    subUploading.value = false
    ;(e.target as HTMLInputElement).value = ''
  }
}

// ---- 替换字幕 ----
function triggerReupload() {
  subUploadError.value = ''
  reuploadInputRef.value?.click()
}

async function handleReupload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  subUploading.value = true
  subUploadError.value = ''

  try {
    if (file.size > 5 * 1024 * 1024) {
      subUploadError.value = '文件过大（超过 5MB），请确认是否为有效字幕文件'
      return
    }
    if (file.size === 0) {
      subUploadError.value = '文件为空，请重新选择'
      return
    }

    const fd = new FormData()
    fd.append('file', file)
    const parsed = await $fetch<{ subtitles: SubtitleCue[], text: string, duration: number }>(
      '/api/video/subtitle/upload', { method: 'POST', body: fd }
    )
    await $fetch(`/api/video/${id}/attach-subtitles`, {
      method: 'POST', body: { subtitles: parsed.subtitles },
    })
    subtitles.value = parsed.subtitles
    subUploadError.value = ''
  } catch (e: any) {
    const msg = e?.message || e?.statusMessage || ''
    if (msg.includes('编码') || msg.includes('encoding')) {
      subUploadError.value = '文件编码不兼容，请用 UTF-8 重新保存字幕文件后再试'
    } else if (msg.includes('格式') || msg.includes('format') || msg.includes('SRT') || msg.includes('VTT')) {
      subUploadError.value = msg
    } else if (msg.includes('解析') || msg.includes('时间戳') || msg.includes('parse')) {
      subUploadError.value = '字幕解析失败：文件格式可能不正确，请检查是否包含有效的时间戳'
    } else {
      subUploadError.value = '替换失败: ' + (msg || '网络错误，请重试')
    }
  } finally {
    subUploading.value = false
    ;(e.target as HTMLInputElement).value = ''
  }
}

// ---- 时间同步 ----
function onTimeUpdate(time: number) {
  currentTime.value = time

  // 查找当前字幕
  const cue = subtitles.value.find(c => time >= c.start && time < c.end)
  activeCueId.value = cue?.id || null

  // 区间循环：从起点 start 到终点 end
  if (loopCueId.value) {
    const startCue = subtitles.value.find(c => c.id === loopCueId.value)
    const endCue = loopEndCueId.value ? subtitles.value.find(c => c.id === loopEndCueId.value) : startCue
    if (!startCue || !endCue) return

    // 确保起点在前
    const loopStart = startCue.index <= endCue.index ? startCue : endCue
    const loopEnd = startCue.index <= endCue.index ? endCue : startCue

    if (time >= loopEnd.end) {
      playerRef.value?.seek(loopStart.start)
    }
  }
}

function onDurationChange(duration: number) {
  totalDuration.value = duration
}

async function onEnded() {
  isPlaying.value = false
  loopCueId.value = null
  loopEndCueId.value = null
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

// ---- 循环控制（多句区间循环） ----
function handleToggleLoop(cue: SubtitleCue) {
  // 已有完整区间：点任意 cue 都清除
  if (loopCueId.value && loopEndCueId.value) {
    loopCueId.value = null
    loopEndCueId.value = null
    return
  }

  // 只有起点，没有终点
  if (loopCueId.value && !loopEndCueId.value) {
    if (cue.id === loopCueId.value) {
      // 再次点击起点 → 取消
      loopCueId.value = null
    } else {
      // 点击不同 cue → 设置终点，形成区间
      loopEndCueId.value = cue.id
    }
    return
  }

  // 没有循环 → 设置起点
  loopCueId.value = cue.id
  loopEndCueId.value = null
  playerRef.value?.seek(cue.start)
  if (!isPlaying.value) playerRef.value?.togglePlay()
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
  if (notesSaveTimer) clearTimeout(notesSaveTimer)
  // 最后保存一次进度和笔记
  if (currentTime.value > 0) saveProgress(currentTime.value)
  saveNotes()
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
    // 鼠标左键已松开（如被 iframe 吞掉 mouseup）→ 强制清理
    if (!(ev.buttons & 1)) { onUp(); return }
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

// 笔记面板拖拽
let notesResizing = false
function startNotesResize(e: MouseEvent) {
  notesResizing = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  const onMove = (ev: MouseEvent) => {
    if (!(ev.buttons & 1)) { onUp(); return }
    if (!notesResizing) return
    const ww = window.innerWidth
    let rw = ww - ev.clientX
    if (rw < 260) rw = 260
    if (rw > 500) rw = 500
    notesSidebarWidth.value = rw
  }
  const onUp = () => {
    notesResizing = false
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
.watch-btn-icon {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px;
  border: 0.5px solid rgba(0,0,0,0.08);
  border-radius: 8px;
  background: transparent;
  color: #6b6963;
  cursor: pointer; transition: all 0.12s;
}
.watch-btn-icon:hover { background: rgba(0,0,0,0.04); color: #1a1a18; }

.watch-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* ── 无字幕上传（侧栏内） ── */
.sub-upload-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 24px;
  flex: 1;
  text-align: center;
}
.sub-upload-icon { margin-bottom: 4px; opacity: 0.5; }
.sub-upload-hint { font-size: 14.5px; font-weight: 500; color: #6b6963; margin: 0; }
.sub-upload-desc {
  font-size: 12px; color: #a09e97; margin: 0;
  line-height: 1.6; max-width: 260px;
}
.sub-upload-actions {
  display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;
}
.sub-upload-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 9px 20px; border: 1px solid rgba(61,53,145,0.3); border-radius: 8px;
  background: #fff; color: #3d3591; font-size: 13px; font-weight: 500;
  cursor: pointer; font-family: inherit; transition: all 0.15s;
}
.sub-upload-btn:hover { background: #f8f7ff; border-color: #3d3591; }
.sub-upload-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.sub-upload-loading {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: #a09e97;
}
.sub-upload-error {
  font-size: 12px; color: #dc2626; margin: 4px 0 0;
  line-height: 1.5; text-align: center; max-width: 280px;
  padding: 8px 12px; background: #fef2f2; border-radius: 6px;
}

.watch-player-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 12px;
  min-width: 0;
}

.watch-sidebar {
  position: relative;
  display: flex;
  flex-direction: column;
  border-left: 0.5px solid rgba(0,0,0,0.08);
  background: #ffffff;
  flex-shrink: 0;
  overflow: visible;
}
.watch-sidebar.hidden { overflow: visible; }
.watch-sidebar.hidden > :not(.subs-toggle) { display: none; }
.subs-toggle {
  position: absolute; top: 8px; left: -12px; z-index: 10;
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 50%;
  cursor: pointer; color: #8a8880; transition: all 0.2s;
}
.subs-toggle:hover { color: #3d3591; border-color: rgba(61,53,145,0.3); }
.watch-sidebar.hidden .subs-toggle { left: -24px; }

.watch-sidebar :deep(.subtitle-list) { flex: 1; min-height: 0; }

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

/* ── 模式切换器 ── */
.mode-switcher {
  display: flex; gap: 0;
  border: 0.5px solid rgba(0,0,0,0.12); border-radius: 8px;
  overflow: hidden; margin-right: 4px;
}
.mode-switcher button {
  width: 34px; height: 28px; border: none; background: #fff; cursor: pointer;
  color: #999; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.mode-switcher button + button { border-left: 0.5px solid rgba(0,0,0,0.08); }
.mode-switcher button:hover { background: #f5f4f2; }
.mode-switcher button.active { background: #3d3591; color: #fff; }

/* ── 音频模式 ── */
.audio-mode-wrap {
  flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0;
}

.audio-layout {
  flex: 1; display: flex; overflow: hidden; min-height: 0;
}

/* 字幕列：笔记隐藏时占满，显示时在左侧 */
.audio-subtitles-col {
  flex: 1; overflow-y: auto; background: #fff; min-height: 0; min-width: 0;
  display: flex; flex-direction: column;
}
.audio-subtitles-col :deep(.subtitle-list) { flex: 1; min-height: 0; }

/* 笔记面板 */
.notes-panel {
  position: relative;
  flex-shrink: 0; display: flex; flex-direction: column;
  background: #faf9f7; min-width: 0; overflow: visible;
}
.notes-panel.hidden { overflow: visible; }
.notes-panel.hidden > :not(.notes-toggle) { display: none; }
.notes-toggle {
  position: absolute; top: 8px; left: -12px; z-index: 10;
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 50%;
  cursor: pointer; color: #8a8880; transition: all 0.2s;
}
.notes-toggle:hover { color: #3d3591; border-color: rgba(61,53,145,0.3); }
.notes-panel.hidden .notes-toggle { left: -24px; }
.notes-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 12px; border-bottom: 0.5px solid rgba(0,0,0,0.06);
  flex-shrink: 0;
}
.notes-label {
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.72rem; font-weight: 600; color: #888;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.notes-header-right {
  display: flex; align-items: center; gap: 4px;
}
.notes-mode-btn {
  padding: 2px 8px; border-radius: 4px; border: 1px solid transparent;
  font-size: 0.68rem; font-family: 'DM Sans', system-ui, sans-serif;
  cursor: pointer; background: transparent; color: #aaa;
  transition: all 0.12s;
}
.notes-mode-btn:hover { color: #666; }
.notes-mode-btn.active {
  background: #3d3591; color: #fff; border-color: #3d3591;
}
.notes-save-btn {
  padding: 3px 10px; border-radius: 4px; border: none;
  font-size: 0.72rem; font-family: 'DM Sans', system-ui, sans-serif;
  cursor: pointer; background: #e8e6e0; color: #666;
  transition: background 0.12s;
}
.notes-save-btn:hover { background: #3d3591; color: #fff; }
.notes-collapse-btn {
  width: 22px; height: 22px; border: none; border-radius: 4px;
  background: transparent; color: #b0ada0; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s; margin-left: 4px;
}
.notes-collapse-btn:hover { background: #e8e6df; color: #3d3591; }
.notes-header.collapsed {
  padding: 4px 6px;
  justify-content: flex-end;
}
.notes-header.collapsed .notes-collapse-btn {
  margin-left: 0;
}
.notes-preview {
  flex: 1; overflow-y: auto; padding: 14px 16px;
  font-size: 0.85rem; line-height: 1.7; color: #333;
}
.notes-preview-empty { color: #ccc; font-size: 0.82rem; text-align: center; margin-top: 40px; }
.notes-preview :deep(h1), .notes-preview :deep(h2), .notes-preview :deep(h3) {
  font-size: 1em; margin: 10px 0 4px; color: #1a1a18;
}
.notes-preview :deep(p) { margin: 0 0 6px; }
.notes-preview :deep(ul), .notes-preview :deep(ol) { padding-left: 18px; margin: 4px 0; }
.notes-preview :deep(code) {
  background: rgba(0,0,0,0.05); padding: 1px 4px; border-radius: 3px; font-size: 0.9em;
}
.notes-preview :deep(blockquote) {
  border-left: 3px solid #3d3591; padding-left: 10px; color: #6b6963; margin: 6px 0;
}
.notes-textarea {
  flex: 1; border: none; outline: none; resize: none;
  padding: 14px 16px; font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.85rem; line-height: 1.7; color: #333;
  background: transparent;
}
.notes-textarea::placeholder { color: #ccc; }

/* ── 手机端适配 ── */
@media (max-width: 767px) {
  .watch-body { flex-direction: column; }
  .watch-player-col { width: 100%; max-height: 50vh; margin-bottom: 12px; }
  .watch-player-col.expanded { max-height: none; }
  .watch-panel { width: 100%; }
  .watch-topbar { padding: 8px 12px; flex-wrap: wrap; gap: 6px; }
  .watch-topbar-center h1 { font-size: 15px; max-width: 60vw; }
  .watch-topbar-right { gap: 6px; }
  .watch-learn-btn { padding: 6px 10px; font-size: 11px; }
  .audio-subtitles-col { width: 100% !important; }
  .notes-panel { width: 100% !important; max-width: 100%; }
  .mode-switcher button { padding: 5px 8px; }
}
</style>
