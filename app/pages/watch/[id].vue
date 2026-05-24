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
          <button :class="{ active: viewMode === 'notes' }" @click="viewMode = 'notes'" title="听写模式">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
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
      <div v-show="viewMode === 'video'" class="watch-player-col">
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
        <div class="watch-sidebar" :style="{ width: sidebarWidth + 'px' }">
          <WatchSubtitles
            v-if="subtitles.length || subtitlesLoading"
            :cues="subtitles" :active-cue-id="activeCueId" :practice="practice"
            :loop-cue-id="loopCueId" :loading="subtitlesLoading"
            @cue-click="handleCueClick" @toggle-save="handleToggleSave"
            @toggle-loop="handleToggleLoop" @mark-mastered="handleMarkMastered"
            @remove-practice="handleRemovePractice"
          />
          <div v-else class="sub-upload-area">
            <p class="sub-upload-hint">暂无字幕</p>
            <label class="sub-upload-btn">
              <input type="file" accept=".srt,.vtt" @change="handleSubUpload" hidden />
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              上传字幕
            </label>
            <div v-if="subUploading" class="sub-upload-loading">
              <div class="mini-spinner"></div>
              <span>处理中…</span>
            </div>
          </div>
          <SubtitleChat
            v-if="subtitles.length"
            :cues="subtitles" :active-cue-id="activeCueId" :title="title"
          />
        </div>
      </template>

      <!-- ── A：纯听 — 音频条 + 全宽字幕 ── -->
      <div v-else-if="viewMode === 'audio'" class="audio-mode-wrap">
        <AudioControlBar
          :current="currentTime" :duration="totalDuration"
          :playing="audioPlaying" :volume="audioVolume"
          @toggle="toggleAudioPlay" @seek="seekAudio" @set-volume="setAudioVolume"
        />
        <div class="audio-subtitles-full">
          <WatchSubtitles
            v-if="subtitles.length || subtitlesLoading"
            :cues="subtitles" :active-cue-id="activeCueId" :practice="practice"
            :loop-cue-id="loopCueId" :loading="subtitlesLoading"
            @cue-click="handleCueClick" @toggle-save="handleToggleSave"
            @toggle-loop="handleToggleLoop" @mark-mastered="handleMarkMastered"
            @remove-practice="handleRemovePractice"
          />
          <div v-else class="sub-upload-area">
            <p class="sub-upload-hint">暂无字幕</p>
            <label class="sub-upload-btn">
              <input type="file" accept=".srt,.vtt" @change="handleSubUpload" hidden />
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              上传字幕
            </label>
            <div v-if="subUploading" class="sub-upload-loading">
              <div class="mini-spinner"></div>
              <span>处理中…</span>
            </div>
          </div>
          <SubtitleChat
            v-if="subtitles.length"
            :cues="subtitles" :active-cue-id="activeCueId" :title="title"
          />
        </div>
      </div>

      <!-- ── B：听写 — 音频条 + 笔记 + 字幕 ── -->
      <div v-else class="notes-mode-wrap">
        <AudioControlBar
          :current="currentTime" :duration="totalDuration"
          :playing="audioPlaying" :volume="audioVolume"
          @toggle="toggleAudioPlay" @seek="seekAudio" @set-volume="setAudioVolume"
        />
        <div class="notes-layout">
          <div class="notes-panel">
            <div class="notes-header">
              <span class="notes-label">笔记</span>
              <div class="notes-header-right">
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
          </div>
          <div class="panel-divider" @mousedown="startNotesResize"></div>
          <div class="notes-subtitles" :style="{ width: notesSidebarWidth + 'px' }">
            <WatchSubtitles
              v-if="subtitles.length || subtitlesLoading"
              :cues="subtitles" :active-cue-id="activeCueId" :practice="practice"
              :loop-cue-id="loopCueId" :loading="subtitlesLoading"
              @cue-click="handleCueClick" @toggle-save="handleToggleSave"
              @toggle-loop="handleToggleLoop" @mark-mastered="handleMarkMastered"
              @remove-practice="handleRemovePractice"
            />
            <div v-else class="sub-upload-area">
              <p class="sub-upload-hint">暂无字幕</p>
              <label class="sub-upload-btn">
                <input type="file" accept=".srt,.vtt" @change="handleSubUpload" hidden />
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                上传字幕
              </label>
              <div v-if="subUploading" class="sub-upload-loading">
                <div class="mini-spinner"></div>
                <span>处理中…</span>
              </div>
            </div>
            <SubtitleChat
              v-if="subtitles.length"
              :cues="subtitles" :active-cue-id="activeCueId" :title="title"
            />
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
</template>

<script setup lang="ts">
import type { SubtitleCue, SubtitlePractice } from '#shared/types'
import MarkdownRenderer from '~/components/MarkdownRenderer.vue'

const route = useRoute()
const router = useRouter()
const id = route.params.id as string

const loaded = ref(false)
const title = ref('')
const source = ref('')
const videoUrl = ref('')
const subtitles = ref<SubtitleCue[]>([])
const subtitlesLoading = ref(false)
const subUploading = ref(false)
const practice = ref<Record<string, SubtitlePractice>>({})
const isPlaying = ref(false)
const currentTime = ref(0)
const totalDuration = ref(0)
const activeCueId = ref<string | null>(null)
const loopCueId = ref<string | null>(null)
const initialTime = ref(0)
const sidebarWidth = ref(380)
const playerRef = ref<any>(null)

// ── 显示模式 ──
const viewMode = ref<'video' | 'audio' | 'notes'>('video')
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

    // 字幕为空 → 仅对 youtube/bilibili 自动后台拉取（本地文件需手动上传）
    if ((!subtitles.value || subtitles.value.length === 0) && (source.value === 'youtube' || source.value === 'bilibili')) {
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

// ---- 手动上传字幕 ----
async function handleSubUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  subUploading.value = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    const parsed = await $fetch<{ subtitles: SubtitleCue[], text: string, duration: number }>('/api/video/subtitle/upload', {
      method: 'POST', body: fd,
    })
    await $fetch(`/api/video/${id}/attach-subtitles`, {
      method: 'POST', body: { subtitles: parsed.subtitles },
    })
    subtitles.value = parsed.subtitles
    title.value = file.name.replace(/\.(srt|vtt)$/i, '')
  } catch (e: any) {
    alert('字幕上传失败: ' + (e?.message || ''))
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
  padding: 32px 20px;
  flex: 1;
}
.sub-upload-hint { font-size: 14px; color: #a09e97; margin: 0; }
.sub-upload-btn {
  display: flex; align-items: center; gap: 5px;
  padding: 8px 16px; border: 1px solid rgba(61,53,145,0.3); border-radius: 8px;
  background: #fff; color: #3d3591; font-size: 13px; font-weight: 450;
  cursor: pointer; font-family: inherit; transition: all 0.15s;
}
.sub-upload-btn:hover { background: #f8f7ff; border-color: #3d3591; }
.sub-upload-loading {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: #a09e97;
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

/* ── 音频/笔记模式包装 ── */
.audio-mode-wrap,
.notes-mode-wrap {
  flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0;
}

/* ── 模式 A：全宽字幕 ── */
.audio-subtitles-full {
  flex: 1; overflow-y: auto; background: #fff; min-height: 0;
  display: flex; flex-direction: column;
}
.audio-subtitles-full :deep(.subtitle-list) { flex: 1; min-height: 0; }

/* ── 模式 B：笔记 + 字幕 ── */
.notes-layout {
  flex: 1; display: flex; overflow: hidden; min-height: 0;
}
.notes-panel {
  flex: 1; display: flex; flex-direction: column;
  background: #faf9f7; min-width: 0;
}
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
.notes-subtitles {
  flex-shrink: 0; overflow: hidden; background: #fff;
  display: flex; flex-direction: column;
  border-left: 0.5px solid rgba(0,0,0,0.08);
}
.notes-subtitles :deep(.subtitle-list) { flex: 1; min-height: 0; }
</style>
