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
        <p class="upload-hint">拖拽文件到此处，或点击选择文件</p>
        <p class="upload-formats">支持 PDF、Markdown、TXT 格式</p>

        <input
          ref="fileInput"
          type="file"
          accept=".pdf,.md,.txt,.markdown"
          class="file-input-hidden"
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
const props = defineProps<{
  rawText: string
  isProcessing: boolean
}>()

const emit = defineEmits<{
  submitText: [text: string, filePath?: string]
  analyze: []
  clear: []
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)
const showPasteArea = ref(false)
const pasteText = ref('')
const uploadLoading = ref(false)
const uploadMessage = ref('')

// ---------- 文件选择 ----------
async function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  await processFile(file)
  // 重置以便再次选择同一文件
  input.value = ''
}

async function handleDrop(e: DragEvent) {
  isDragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  await processFile(file)
}

// ---------- 文件处理 ----------
async function processFile(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase()

  // PDF：上传到服务端解析
  if (ext === 'pdf') {
    uploadLoading.value = true
    uploadMessage.value = '正在上传 PDF...'
    try {
      const formData = new FormData()
      formData.append('file', file)

      const result = await $fetch<{ text: string; filePath?: string }>('/api/parse-pdf', {
        method: 'POST',
        body: formData,
      })

      if (result?.text) {
        emit('submitText', result.text, result.filePath)
      } else {
        alert('PDF 解析后未提取到文本')
      }
    } catch (err: any) {
      console.error('PDF 上传解析失败:', err)
      alert('PDF 解析失败: ' + (err?.message || err?.statusMessage || '请尝试粘贴文本'))
    } finally {
      uploadLoading.value = false
      uploadMessage.value = ''
    }
    return
  }

  // MD / TXT：直接读取
  if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
    uploadLoading.value = true
    uploadMessage.value = '正在读取文件...'
    try {
      const text = await file.text()
      if (text.trim()) {
        emit('submitText', text)
        // 同时保存到服务端
        $fetch('/api/text/save', {
          method: 'POST',
          body: { text, source: file.name },
        }).catch(() => {})
      }
    } catch (err: any) {
      console.error('文件读取失败:', err)
      alert('文件读取失败: ' + (err?.message || '未知错误'))
    } finally {
      uploadLoading.value = false
      uploadMessage.value = ''
    }
    return
  }

  alert('不支持的文件格式，请上传 PDF、Markdown 或 TXT 文件')
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
