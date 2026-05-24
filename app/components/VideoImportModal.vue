<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content video-import-modal">
      <div class="modal-header">
        <span>导入视频</span>
        <button class="modal-close" @click="$emit('close')">&times;</button>
      </div>

      <div class="vim-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="vim-tab"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >{{ tab.label }}</button>
      </div>

      <!-- Tab 1: URL 导入（支持单视频 + 播放列表） -->
      <div v-if="activeTab === 'url'" class="vim-panel">
        <div class="vim-hint">支持 YouTube 和 Bilibili 链接，字幕将在播放页面后台自动加载</div>

        <!-- 输入区域（非 playlist 模式） -->
        <template v-if="!playlistData">
          <input
            v-model="urlInput"
            class="vim-input"
            placeholder="https://www.youtube.com/watch?v=... 或 playlist 链接"
            :disabled="urlLoading"
            @keydown.enter="handleUrlSubmit"
          />
          <div v-if="urlLoading" class="processing"><div class="spinner"></div><p>获取播放列表...</p></div>
        </template>

        <!-- Playlist 列表 -->
        <div v-else class="vim-playlist">
          <div class="vim-playlist-header">
            <span class="vim-playlist-title">{{ playlistData.playlistTitle }}</span>
            <span class="vim-playlist-count">{{ playlistData.totalCount }} 个视频</span>
          </div>

          <div class="vim-playlist-list">
            <label class="vim-playlist-all">
              <input type="checkbox" :checked="selectAll" @change="toggleSelectAll" />
              <span>全选</span>
            </label>
            <div v-for="v in visibleVideos" :key="v.id" class="vim-playlist-item">
              <label class="vim-playlist-label">
                <input type="checkbox" :checked="selectedVideos.has(v.id)" @change="toggleVideo(v.id)" />
                <span class="vim-playlist-title-text">{{ v.title }}</span>
              </label>
            </div>
            <div v-if="playlistData.totalCount > visibleLimit" class="vim-playlist-more">
              还有 {{ playlistData.totalCount - visibleLimit }} 个视频未显示，将全部导入
            </div>
          </div>

          <!-- 批量导入进度 -->
          <div v-if="importing" class="vim-progress">
            <div class="processing"><div class="spinner"></div><p>正在批量导入…</p></div>
          </div>
          <div v-if="batchProgress" class="vim-progress">
            <div class="vim-progress-track">
              <div class="vim-progress-fill" :style="{ width: progressPercent + '%' }"></div>
            </div>
            <p class="vim-progress-text">正在获取元数据 {{ batchProgress.current }}/{{ batchProgress.total }}</p>
          </div>

          <!-- 操作按钮 -->
          <div v-if="!importing && !batchProgress && !importResult" class="vim-playlist-actions">
            <button class="btn-ghost" @click="resetPlaylist">取消</button>
            <button class="btn-primary" :disabled="selectedCount === 0" @click="confirmPlaylistImport">
              导入 {{ selectedCount }} 个视频
            </button>
          </div>

          <!-- 导入结果 -->
          <div v-if="importResult" class="vim-playlist-result">
            <p>✓ 导入 {{ importResult.imported }} 个视频（跳过 {{ importResult.skipped }} 个重复）</p>
            <p class="vim-playlist-result-sub">已创建文件夹「{{ importResult.folderName }}」，元数据正在后台获取…</p>
            <button class="btn-primary" style="margin-top: 12px" @click="finishImport">完成</button>
          </div>
        </div>
      </div>

      <!-- Tab 2: 上传字幕文件 -->
      <div v-if="activeTab === 'file'" class="vim-panel">
        <div class="vim-hint">上传 .srt 或 .vtt 字幕文件，可选关联视频文件</div>
        <div class="upload-area" @dragover.prevent @drop.prevent="handleFileDrop">
          <div class="upload-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <p class="upload-hint">点击选择或拖拽字幕文件</p>
          <p class="upload-formats">SRT, VTT</p>
          <input ref="fileInputRef" type="file" accept=".srt,.vtt" class="file-input-hidden" @change="handleFileSelect" />
          <button class="btn-outline" @click="fileInputRef?.click()">选择文件</button>
        </div>
        <div v-if="fileLoading" class="processing"><div class="spinner"></div><p>正在解析字幕...</p></div>
        <div v-if="filePreview" class="vim-preview">
          <div class="vim-preview-info">
            <span class="vim-cue-count">{{ filePreview.subtitles.length }} 条字幕 · {{ filePreview.durationFormatted }}</span>
          </div>
          <div class="vim-preview-list">
            <div v-for="cue in filePreview.subtitles.slice(0, 5)" :key="cue.id" class="vim-preview-cue">
              <span class="vim-cue-time">{{ formatTime(cue.start) }}</span>
              <span class="vim-cue-text">{{ cue.text }}</span>
            </div>
            <div v-if="filePreview.subtitles.length > 5" class="vim-preview-more">
              ... 还有 {{ filePreview.subtitles.length - 5 }} 条
            </div>
          </div>
          <div class="vim-file-row">
            <label class="vim-file-label">关联视频文件（可选）</label>
            <button class="btn-outline" @click="videoFileInputRef?.click()">
              {{ attachedVideo ? attachedVideo.name : '选择视频/音频' }}
            </button>
            <input ref="videoFileInputRef" type="file" accept=".mp4,.webm,.mp3,.m4a,.wav" class="file-input-hidden" @change="handleVideoSelect" />
          </div>
          <div class="paste-actions">
            <button class="btn-ghost" @click="resetFilePreview">取消</button>
            <button class="btn-primary" :disabled="!filePreview" @click="confirmFileImport">确认导入</button>
          </div>
        </div>
      </div>

      <!-- Tab 3: 上传视频文件 -->
      <div v-if="activeTab === 'video'" class="vim-panel">
        <div class="vim-hint">上传视频或音频文件，可稍后在播放页面上传字幕</div>
        <div class="upload-area" @dragover.prevent @drop.prevent="handleVideoDrop">
          <div class="upload-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
            </svg>
          </div>
          <p class="upload-hint">点击选择或拖拽视频/音频文件</p>
          <p class="upload-formats">MP4, WebM, MP3, M4A, WAV (最大 200MB)</p>
          <input ref="videoOnlyInputRef" type="file" accept=".mp4,.webm,.mp3,.m4a,.wav" class="file-input-hidden" @change="handleVideoOnlySelect" />
          <button class="btn-outline" @click="videoOnlyInputRef?.click()">选择文件</button>
        </div>
        <div v-if="videoUploading" class="processing"><div class="spinner"></div><p>正在上传...</p></div>
        <div v-if="videoUploaded" class="vim-preview">
          <div class="vim-preview-info">
            <p>已上传: {{ videoUploaded.originalName }}</p>
          </div>
          <div class="vim-file-row">
            <label class="vim-file-label">字幕文件（可选）</label>
            <button class="btn-outline" @click="subForVideoRef?.click()">
              {{ attachedSubFile ? attachedSubFile.name : '选择字幕 (SRT/VTT)' }}
            </button>
            <input ref="subForVideoRef" type="file" accept=".srt,.vtt" class="file-input-hidden" @change="handleSubForVideoSelect" />
          </div>
          <div class="paste-actions">
            <button class="btn-ghost" @click="resetVideoUpload">取消</button>
            <button class="btn-primary" @click="confirmVideoImport">确认导入</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface SubtitleCue {
  id: string; index: number; start: number; end: number; text: string
}

interface PreviewData {
  title: string
  type: string
  url: string
  duration: number
  durationFormatted: string
  thumbnail: string
  subtitles?: SubtitleCue[]
}

interface PlaylistVideo {
  id: string; title: string; url: string
}

interface PlaylistData {
  playlistTitle: string
  totalCount: number
  videos: PlaylistVideo[]
}

const emit = defineEmits<{
  imported: [result: { id: string; title: string }]
  close: []
}>()

const activeTab = ref('url')
const tabs = [
  { key: 'url', label: '链接导入' },
  { key: 'file', label: '上传字幕' },
  { key: 'video', label: '上传视频' },
]

// ============================================================
//  Tab 1: URL 导入（单视频 + 播放列表）
// ============================================================
const urlInput = ref('')
const urlLoading = ref(false)

// Playlist 状态
const playlistData = ref<PlaylistData | null>(null)
const selectedVideos = ref<Set<string>>(new Set())
const selectAll = ref(true)
const visibleLimit = 20
const importing = ref(false)
const importResult = ref<{ folderId: string; folderName: string; imported: number; skipped: number } | null>(null)
const batchId = ref<string | null>(null)
const batchProgress = ref<{ total: number; current: number; done: boolean } | null>(null)

const visibleVideos = computed(() => playlistData.value?.videos.slice(0, visibleLimit) || [])
const selectedCount = computed(() => selectedVideos.value.size)
const progressPercent = computed(() => {
  if (!batchProgress.value || batchProgress.value.total === 0) return 0
  return Math.round((batchProgress.value.current / batchProgress.value.total) * 100)
})

function isPlaylistUrl(url: string): boolean {
  return url.includes('list=') || url.includes('/playlist/')
}

async function handleUrlSubmit() {
  const url = urlInput.value.trim()
  if (!url) return
  if (isPlaylistUrl(url)) {
    await loadPlaylist(url)
  } else {
    await quickSave(url)
  }
}

async function loadPlaylist(url: string) {
  urlLoading.value = true
  playlistData.value = null
  try {
    const data = await $fetch<PlaylistData>('/api/video/playlist-listing', {
      method: 'POST',
      body: { url },
    })
    playlistData.value = data
    selectedVideos.value = new Set(data.videos.map(v => v.id))
    selectAll.value = true
  } catch (e: any) {
    alert('获取播放列表失败: ' + (e?.message || e?.statusMessage || '未知错误'))
  } finally {
    urlLoading.value = false
  }
}

function toggleSelectAll() {
  if (!playlistData.value) return
  if (selectAll.value) {
    selectedVideos.value = new Set()
    selectAll.value = false
  } else {
    selectedVideos.value = new Set(playlistData.value.videos.map(v => v.id))
    selectAll.value = true
  }
}

function toggleVideo(id: string) {
  const next = new Set(selectedVideos.value)
  if (next.has(id)) {
    next.delete(id)
    selectAll.value = false
  } else {
    next.add(id)
    selectAll.value = next.size === playlistData.value?.videos.length
  }
  selectedVideos.value = next
}

async function confirmPlaylistImport() {
  if (!playlistData.value || selectedCount.value === 0) return
  importing.value = true
  try {
    const selected = playlistData.value.videos.filter(v => selectedVideos.value.has(v.id))
    const result = await $fetch<{
      folderId: string; folderName: string; imported: number; skipped: number; importedIds: string[]
    }>('/api/video/playlist-import', {
      method: 'POST',
      body: {
        playlistTitle: playlistData.value.playlistTitle,
        videos: selected,
      },
    })
    importResult.value = result
    importing.value = false

    // 启动后台元数据拉取
    if (result.importedIds.length > 0) {
      try {
        const batchRes = await $fetch<{ batchId: string; total: number }>('/api/video/batch-metadata', {
          method: 'POST',
          body: { ids: result.importedIds },
        })
        batchId.value = batchRes.batchId
        pollBatchProgress()
      } catch {
        // 元数据拉取不是必须的，静默失败
      }
    }
  } catch (e: any) {
    alert('批量导入失败: ' + (e?.message || e?.statusMessage || '未知错误'))
    importing.value = false
  }
}

function pollBatchProgress() {
  if (!batchId.value) return
  const timer = setInterval(async () => {
    try {
      const state = await $fetch<{ total: number; current: number; done: boolean }>(
        `/api/video/batch-progress?batchId=${batchId.value}`
      )
      batchProgress.value = state
      if (state.done) {
        clearInterval(timer)
      }
    } catch {
      clearInterval(timer)
    }
  }, 3000)
}

function resetPlaylist() {
  playlistData.value = null
  selectedVideos.value = new Set()
  selectAll.value = true
  importResult.value = null
  batchId.value = null
  batchProgress.value = null
  importing.value = false
  urlInput.value = ''
  urlLoading.value = false
}

function finishImport() {
  // playlist 导入后不跳转播放页，只刷新书架
  emit('imported', { id: '', title: '' })
}

async function quickSave(url: string) {
  urlLoading.value = true
  try {
    const result = await $fetch<{ id: string; title: string }>('/api/video/quick-save', {
      method: 'POST',
      body: { url },
    })
    emit('imported', result)
    urlInput.value = ''

    // 后台立即提取字幕，不等用户打开播放页
    $fetch(`/api/video/extract-subtitles/${result.id}`, { method: 'POST' }).catch(() => {})
  } catch (e: any) {
    alert('导入失败: ' + (e?.message || e?.statusMessage || '未知错误'))
  } finally {
    urlLoading.value = false
  }
}

// ============================================================
//  Tab 2: 上传字幕文件
// ============================================================
const fileInputRef = ref<HTMLInputElement | null>(null)
const videoFileInputRef = ref<HTMLInputElement | null>(null)
const fileLoading = ref(false)
const filePreview = ref<PreviewData | null>(null)
const attachedVideo = ref<File | null>(null)

async function handleFileDrop(e: DragEvent) {
  const file = e.dataTransfer?.files?.[0]
  if (file) await processSubFile(file)
}

function handleFileSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) processSubFile(file)
}

async function processSubFile(file: File) {
  fileLoading.value = true
  filePreview.value = null
  try {
    const formData = new FormData()
    formData.append('file', file)
    const result = await $fetch<PreviewData>('/api/video/subtitle/upload', {
      method: 'POST',
      body: formData,
    })
    filePreview.value = {
      ...result,
      title: file.name.replace(/\.(srt|vtt)$/i, ''),
      type: 'video_file',
      url: '',
      thumbnail: '',
    }
  } catch (e: any) {
    alert('字幕解析失败: ' + (e?.message || e?.statusMessage || '未知错误'))
  } finally {
    fileLoading.value = false
  }
}

function handleVideoSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) attachedVideo.value = file
}

async function confirmFileImport() {
  if (!filePreview.value) return

  let filePath = ''
  let videoUrl = ''
  if (attachedVideo.value) {
    try {
      const formData = new FormData()
      formData.append('file', attachedVideo.value)
      const result = await $fetch<{ filePath: string; url: string }>('/api/file/upload-video', {
        method: 'POST',
        body: formData,
      })
      filePath = result.filePath
      videoUrl = result.url
    } catch (e: any) {
      alert('视频上传失败: ' + (e?.message || ''))
      return
    }
  }

  try {
    const result = await $fetch<{ id: string; title: string }>('/api/video/save', {
      method: 'POST',
      body: {
        title: filePreview.value.title,
        url: videoUrl || filePreview.value.title,
        type: filePath ? 'video_file' : 'audio_file',
        subtitles: filePreview.value.subtitles,
        duration: filePreview.value.duration,
        filePath,
      },
    })
    emit('imported', result)
    resetFilePreview()
  } catch (e: any) {
    alert('导入失败: ' + (e?.message || e?.statusMessage || '未知错误'))
  }
}

function resetFilePreview() {
  filePreview.value = null
  attachedVideo.value = null
  fileLoading.value = false
}

// ============================================================
//  Tab 3: 上传视频文件
// ============================================================
const videoOnlyInputRef = ref<HTMLInputElement | null>(null)
const subForVideoRef = ref<HTMLInputElement | null>(null)
const videoUploading = ref(false)
const videoUploaded = ref<{ filePath: string; url: string; originalName: string } | null>(null)
const attachedSubFile = ref<File | null>(null)
const videoThumbnailUrl = ref('')
let videoRawFile: File | null = null

async function handleVideoDrop(e: DragEvent) {
  const file = e.dataTransfer?.files?.[0]
  if (file) await uploadVideoOnly(file)
}

function handleVideoOnlySelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) uploadVideoOnly(file)
}

async function uploadVideoOnly(file: File) {
  videoUploading.value = true; videoUploaded.value = null; videoThumbnailUrl.value = ''
  videoRawFile = file
  try {
    // 并行：上传视频 + 捕获缩略图
    const formData = new FormData(); formData.append('file', file)
    const [result, thumbUrl] = await Promise.all([
      $fetch<{ filePath: string; url: string; originalName: string }>('/api/file/upload-video', { method: 'POST', body: formData }),
      captureVideoThumbnail(file),
    ])
    videoUploaded.value = result
    if (thumbUrl) videoThumbnailUrl.value = thumbUrl
  } catch (e: any) {
    alert('上传失败: ' + (e?.message || ''))
  } finally {
    videoUploading.value = false
  }
}

/** 用 <video> + <canvas> 截取视频第 10% 处的一帧作为封面 */
async function captureVideoThumbnail(file: File): Promise<string> {
  const vid = document.createElement('video')
  vid.preload = 'metadata'; vid.muted = true; vid.playsInline = true
  const blobUrl = URL.createObjectURL(file)
  vid.src = blobUrl

  return new Promise((resolve) => {
    let cleaned = false
    const clean = () => { if (!cleaned) { cleaned = true; URL.revokeObjectURL(blobUrl); vid.remove() } }

    const capture = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 320; canvas.height = Math.round(320 / (vid.videoWidth / vid.videoHeight) || 180)
      const ctx = canvas.getContext('2d')
      if (!ctx) { clean(); return resolve('') }
      ctx.drawImage(vid, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(async (blob) => {
        clean()
        if (!blob) return resolve('')
        try {
          const fd = new FormData(); fd.append('file', blob, 'thumb.jpg')
          const res = await $fetch<{ url: string; path: string; size: number }>('/api/file/upload-thumbnail', { method: 'POST', body: fd })
          resolve(res.path)
        } catch { resolve('') }
      }, 'image/jpeg', 0.8)
    }

    vid.onloadedmetadata = () => {
      vid.currentTime = Math.min(15, vid.duration * 0.1)
    }
    vid.onseeked = () => { capture() }
    vid.onerror = () => { clean(); resolve('') }
    // 超时兜底
    setTimeout(() => { if (!cleaned) { clean(); resolve('') } }, 15000)
  })
}

function handleSubForVideoSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) attachedSubFile.value = file
}

async function confirmVideoImport() {
  if (!videoUploaded.value) return

  let subtitles: SubtitleCue[] = []
  let duration = 0
  let title = videoUploaded.value.originalName.replace(/\.[^.]+$/, '')

  try {
    if (attachedSubFile.value) {
      const subFormData = new FormData()
      subFormData.append('file', attachedSubFile.value)
      const subResult = await $fetch<{ subtitles: SubtitleCue[]; text: string; duration: number }>('/api/video/subtitle/upload', {
        method: 'POST',
        body: subFormData,
      })
      subtitles = subResult.subtitles
      duration = subResult.duration
      title = attachedSubFile.value.name.replace(/\.(srt|vtt)$/i, '')
    }

    const result = await $fetch<{ id: string; title: string }>('/api/video/save', {
      method: 'POST',
      body: {
        title,
        url: videoUploaded.value.url,
        type: 'video_file',
        subtitles,
        duration: duration || 0,
        filePath: videoUploaded.value.filePath,
        thumbnail: videoThumbnailUrl.value,
      },
    })
    emit('imported', result)
    resetVideoUpload()
  } catch (e: any) {
    alert('导入失败: ' + (e?.message || e?.statusMessage || '未知错误'))
  }
}

function resetVideoUpload() {
  videoUploaded.value = null
  attachedSubFile.value = null
  videoUploading.value = false
}

// ============================================================
//  通用工具
// ============================================================
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
</script>

<style scoped>
.video-import-modal {
  max-width: 560px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.vim-tabs {
  display: flex;
  gap: 0;
  border-bottom: 0.5px solid rgba(0,0,0,0.08);
  padding: 0 16px;
}

.vim-tab {
  padding: 10px 16px;
  font-size: 12.5px;
  font-weight: 500;
  color: #8a8880;
  background: transparent;
  border: none;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.12s, border-color 0.12s;
  font-family: 'DM Sans', sans-serif;
}
.vim-tab:hover { color: #4a4a46; }
.vim-tab.active {
  color: #3d3591;
  border-bottom-color: #3d3591;
}

.vim-panel {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.vim-hint {
  font-size: 12px;
  color: #a09e97;
  margin-bottom: 14px;
  line-height: 1.5;
}

.vim-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 13px;
  font-family: 'DM Sans', sans-serif;
  color: #1a1a18;
  background: #fff;
  transition: border-color 0.15s;
}
.vim-input:focus {
  outline: none;
  border-color: #3d3591;
}
.vim-input::placeholder { color: #c0bdb4; }

/* ── Playlist UI ── */
.vim-playlist {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.vim-playlist-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding-bottom: 8px;
  border-bottom: 0.5px solid rgba(0,0,0,0.08);
}
.vim-playlist-title {
  font-family: 'Lora', Georgia, serif;
  font-size: 15px;
  font-weight: 500;
  color: #1a1a18;
}
.vim-playlist-count {
  font-size: 11.5px;
  color: #a09e97;
  font-family: 'DM Mono', monospace;
}

.vim-playlist-list {
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.vim-playlist-all {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  font-size: 12px;
  font-weight: 500;
  color: #3d3591;
  cursor: pointer;
  border-bottom: 0.5px solid rgba(0,0,0,0.06);
  margin-bottom: 4px;
}

.vim-playlist-item {
  padding: 4px 8px;
  border-radius: 6px;
  transition: background 0.1s;
}
.vim-playlist-item:hover {
  background: rgba(0,0,0,0.03);
}

.vim-playlist-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 12.5px;
  color: #4a4a46;
}

.vim-playlist-title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.5;
}

.vim-playlist-more {
  text-align: center;
  font-size: 11px;
  color: #a09e97;
  padding: 10px 0;
}

.vim-playlist-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
}

.vim-playlist-result {
  padding: 14px;
  background: #f0fdf4;
  border-radius: 10px;
  font-size: 13px;
  color: #166534;
  line-height: 1.5;
  text-align: center;
}
.vim-playlist-result-sub {
  font-size: 11.5px;
  color: #6b6963;
  margin-top: 4px;
}

/* ── 批量进度 ── */
.vim-progress {
  padding: 8px 0;
}
.vim-progress-text {
  font-size: 12px;
  color: #a09e97;
  text-align: center;
  margin-top: 6px;
  font-family: 'DM Mono', monospace;
}
.vim-progress-track {
  width: 100%;
  height: 6px;
  background: rgba(0,0,0,0.06);
  border-radius: 3px;
  overflow: hidden;
}
.vim-progress-fill {
  height: 100%;
  background: #3d3591;
  border-radius: 3px;
  transition: width 0.5s ease;
}

/* ── 预览区域 ── */
.vim-preview {
  margin-top: 16px;
  border: 0.5px solid rgba(0,0,0,0.09);
  border-radius: 10px;
  padding: 14px;
  background: #fafaf8;
}

.vim-preview-header {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.vim-thumb {
  width: 80px;
  height: 48px;
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
  background: #e2e8f0;
}
.vim-thumb img { width: 100%; height: 100%; object-fit: cover; }

.vim-preview-info {
  flex: 1;
  font-size: 13px;
  line-height: 1.5;
}
.vim-cue-count {
  display: block;
  font-size: 11.5px;
  color: #a09e97;
  margin-top: 4px;
  font-family: 'DM Mono', monospace;
}

.vim-preview-list {
  margin: 10px 0;
}

.vim-preview-cue {
  display: flex;
  gap: 10px;
  padding: 6px 0;
  font-size: 12.5px;
  line-height: 1.5;
  border-bottom: 0.5px solid rgba(0,0,0,0.06);
}
.vim-preview-cue:last-child { border-bottom: none; }

.vim-cue-time {
  flex-shrink: 0;
  color: #3d3591;
  font-family: 'DM Mono', monospace;
  font-size: 11px;
  padding-top: 2px;
  width: 42px;
}

.vim-cue-text {
  color: #4a4a46;
}

.vim-preview-pending {
  display: flex; align-items: center; gap: 8px;
  padding: 16px 0; font-size: 12.5px; color: #a09e97;
  justify-content: center;
}
.vim-preview-pending .mini-spinner {
  width: 14px; height: 14px; border-width: 1.5px;
}

.vim-preview-more {
  font-size: 11px;
  color: #a09e97;
  padding: 8px 0;
  text-align: center;
}

.vim-file-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 0 4px;
  font-size: 12.5px;
}
.vim-file-label {
  color: #6b6963;
  flex-shrink: 0;
}
</style>
