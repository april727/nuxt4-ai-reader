<template>
  <div class="text-uploader" :class="{ 'is-dragging': isDragging }">
    <div
      class="upload-area"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="handleDrop"
    >
      <!-- 初始状态：上传或粘贴入口 -->
      <div v-if="!rawText && !showPasteArea" class="upload-placeholder">
        <div class="upload-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="12" y1="18" x2="12" y2="12"/>
            <line x1="9" y1="15" x2="12" y2="12"/>
            <line x1="15" y1="15" x2="12" y2="12"/>
          </svg>
        </div>
        <p class="upload-hint">拖拽文件到此处，或点击选择文件（支持多选）</p>
        <p class="upload-formats">支持 PDF、Markdown、TXT、MP4、MP3 等格式</p>

        <input
          ref="fileInput"
          type="file"
          accept=".pdf,.md,.txt,.markdown,.mp4,.webm,.mp3,.wav,.m4a,.ogg,.mov"
          class="file-input-hidden"
          multiple
          @change="handleFileSelect"
        />

        <button class="btn-outline" @click="fileInput?.click()">选择文件</button>

        <div class="divider"><span>或者</span></div>

        <button class="btn-outline" @click="showPasteArea = true">粘贴文本</button>
      </div>

      <!-- 粘贴文本区域 -->
      <div v-if="showPasteArea && !rawText" class="paste-area">
        <textarea
          v-model="pasteText"
          class="paste-textarea"
          placeholder="在此粘贴文章内容..."
          rows="12"
        ></textarea>
        <div class="paste-actions">
          <button class="btn-ghost" @click="showPasteArea = false; pasteText = ''">取消</button>
          <button
            class="btn-primary"
            :disabled="!pasteText.trim() || uploadLoading"
            @click="submitPaste"
          >
            提交文本
          </button>
        </div>
      </div>

      <!-- 已加载文本预览 -->
      <div v-if="rawText && !isProcessing" class="text-preview">
        <div class="preview-header">
          <span class="preview-label">已加载文本</span>
          <span class="preview-count">{{ rawText.length }} 字符</span>
        </div>
        <div class="preview-content">
          {{ rawText.slice(0, 300) }}{{ rawText.length > 300 ? '...' : '' }}
        </div>
        <div class="preview-actions">
          <button class="btn-ghost" @click="clearText">清除</button>
          <button class="btn-primary" :disabled="isProcessing" @click="emit('analyze')">
            开始分析
          </button>
        </div>
      </div>

      <!-- 上传/解析中 -->
      <div v-if="uploadLoading" class="processing">
        <div class="spinner"></div>
        <p>{{ uploadMessage }}</p>
      </div>
    </div>

    <!-- 全局处理中 -->
    <div v-if="isProcessing" class="processing">
      <div class="spinner"></div>
      <p>AI 正在分析文章...</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { captureVideoThumbnail } from '~/composables/useVideoThumbnail'

const props = defineProps<{
  rawText: string
  isProcessing: boolean
}>()

const emit = defineEmits<{
  submitText: [text: string, filePath?: string]
  analyze: []
  clear: []
  batchDone: []
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)
const showPasteArea = ref(false)
const pasteText = ref('')
const uploadLoading = ref(false)
const uploadMessage = ref('')
const batchFileCount = ref(0)

// ---------- 文件选择（支持多选） ----------
async function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  if (!files.length) return
  await processFiles(files)
  input.value = ''
}

async function handleDrop(e: DragEvent) {
  isDragging.value = false
  const files = Array.from(e.dataTransfer?.files || [])
  if (!files.length) return
  await processFiles(files)
}

// ---------- 批量文件处理 ----------
const TXT_EXTS = ['pdf', 'md', 'markdown', 'txt']
const VID_EXTS = ['mp4', 'webm', 'ogg', 'mov', 'mp3', 'wav', 'm4a']

async function processFiles(files: File[]) {
  const supported = files.filter(f => {
    const ext = f.name.split('.').pop()?.toLowerCase()
    return ext && [...TXT_EXTS, ...VID_EXTS].includes(ext)
  })

  if (!supported.length) {
    alert('未找到支持的文件格式（PDF / Markdown / TXT / MP4 / MP3 等）')
    return
  }

  batchFileCount.value = supported.length

  // 单文件：走原有 emit 流程
  if (supported.length === 1) {
    uploadLoading.value = true
    uploadMessage.value = `正在处理 ${supported[0].name}...`
    try {
      await processSingle(supported[0])
    } catch (err: any) {
      alert(err?.message || '处理失败')
    }
    uploadLoading.value = false
    uploadMessage.value = ''
    batchFileCount.value = 0
    return
  }

  // 多文件：内部批量处理，不发 emit
  let done = 0
  for (const file of supported) {
    uploadLoading.value = true
    uploadMessage.value = `(${done + 1}/${supported.length}) ${file.name}`
    try {
      await saveFileDirectly(file)
      done++
    } catch (err: any) {
      console.warn(`[batch] ${file.name}:`, err?.message)
    }
  }

  uploadLoading.value = false
  uploadMessage.value = ''
  batchFileCount.value = 0

  // 通知父组件刷新书架
  emit('batchDone')
  closeModal()
}

/** 单文件：走原有 emit 流程（仅文本类型，视频走批量逻辑）*/
async function processSingle(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') {
    const fd = new FormData(); fd.append('file', file)
    const result = await $fetch<{ text: string; filePath?: string }>('/api/parse-pdf', { method: 'POST', body: fd })
    if (result?.text) {
      emit('submitText', result.text, result.filePath)
    } else {
      throw new Error('PDF 解析后未提取到文本')
    }
  } else if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
    const text = await file.text()
    if (text.trim()) {
      emit('submitText', text)
    }
  } else {
    throw new Error(`不支持的文件格式: ${ext}`)
  }
}

/** 批量模式：直接调用 API，不 emit */
async function saveFileDirectly(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (TXT_EXTS.includes(ext!)) {
    if (ext === 'pdf') {
      const fd = new FormData(); fd.append('file', file)
      const result = await $fetch<{ text: string; filePath: string }>('/api/parse-pdf', { method: 'POST', body: fd })
      if (result?.text) {
        await $fetch('/api/text/save', { method: 'POST', body: { text: result.text, source: file.name, filePath: result.filePath } })
      }
    } else {
      const text = await file.text()
      if (text.trim()) {
        await $fetch('/api/text/save', { method: 'POST', body: { text, source: file.name } })
      }
    }
  } else if (VID_EXTS.includes(ext!)) {
    // 视频/音频文件：上传 → 捕获缩略图 → 保存
    const isAudio = ['mp3', 'wav', 'm4a'].includes(ext!)
    const fd = new FormData(); fd.append('file', file)
    const up = await $fetch<{ filePath: string; url: string }>('/api/file/upload-video', { method: 'POST', body: fd })

    let thumb = ''
    if (!isAudio) {
      try { thumb = await captureVideoThumbnail(file) } catch {}
    }

    await $fetch('/api/video/save', {
      method: 'POST',
      body: { title: file.name.replace(/\.[^.]+$/, ''), url: up.url, type: isAudio ? 'audio_file' : 'video_file', filePath: up.filePath, thumbnail: thumb },
    })
  }
}

function closeModal() {
  showPasteArea.value = false
  pasteText.value = ''
}

// ---------- 粘贴提交 ----------
function submitPaste() {
  const text = pasteText.value.trim()
  if (!text || uploadLoading.value) return

  emit('submitText', text)
  pasteText.value = ''
  showPasteArea.value = false

  // 后台保存到服务端
  $fetch('/api/text/save', {
    method: 'POST',
    body: { text, source: 'paste' },
  }).catch(() => {})
}

// ---------- 清除 ----------
function clearText() {
  emit('clear')
}
</script>
