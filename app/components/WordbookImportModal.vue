<template>
  <Teleport to="body">
    <div class="wim-overlay" @click.self="$emit('close')">
      <div class="wim-modal">
        <h3>导入单词</h3>

        <div class="wim-tabs">
          <button :class="{ active: tab === 'paste' }" @click="tab = 'paste'">粘贴</button>
          <button :class="{ active: tab === 'file' }" @click="tab = 'file'">文件</button>
        </div>

        <!-- 粘贴模式 -->
        <textarea
          v-if="tab === 'paste'"
          v-model="textInput"
          class="wim-textarea"
          placeholder="每行一个单词/短语&#10;ubiquitous&#10;phenomenon&#10;paradigm shift"
        ></textarea>

        <!-- 文件预览 -->
        <div v-else class="wim-file-preview">
          <div class="wim-words-scroll">
            <span v-for="(w, i) in importWords" :key="i" class="wim-word-tag">{{ w }}</span>
          </div>
          <p v-if="importWords.length">{{ importWords.length }} 个单词</p>
        </div>

        <!-- 目标单词本 -->
        <div class="wim-target">
          <label>目标单词本</label>
          <select v-model="targetBookId" class="wim-select">
            <option v-for="b in bookList" :key="b.id" :value="b.id">{{ b.isDefault ? '⭐' : '📒' }} {{ b.name }}</option>
            <option value="__new__">+ 新建单词本</option>
          </select>
          <input v-if="targetBookId === '__new__'" v-model="newBookName" class="wim-input" placeholder="单词本名称" />
        </div>

        <!-- 操作 -->
        <div class="wim-actions">
          <button @click="$emit('close')">取消</button>
          <button class="wim-primary" :disabled="!valid" @click="doImport">
            <template v-if="importing"><span class="spinner"></span> AI 增强中…</template>
            <template v-else>确认导入 {{ importWords.length }} 词</template>
          </button>
        </div>

        <div v-if="result" class="wim-result">{{ result }}</div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{ file: File }>()
const emit = defineEmits<{ close: []; done: [] }>()

const tab = ref('paste')
const textInput = ref('')
const targetBookId = ref('wb_default')
const newBookName = ref('')
const importing = ref(false)
const result = ref('')
const bookList = ref<any[]>([])

const importWords = computed(() => {
  const source = tab.value === 'paste' ? textInput.value : fileText.value
  return source.split(/[\n\r]+/).map((l: string) => l.trim().replace(/^[•\-\d]+[\.\)]\s*/, '')).filter(Boolean)
})

const valid = computed(() => importWords.value.length > 0 && (targetBookId.value !== '__new__' || newBookName.value.trim()))

const fileText = ref('')

// 读文件
onMounted(async () => {
  const reader = new FileReader()
  reader.onload = () => { fileText.value = reader.result as string; tab.value = 'file' }
  reader.readAsText(props.file)
  // 加载单词本列表
  try { bookList.value = await $fetch<any[]>('/api/wordbooks') } catch {}
})

async function doImport() {
  importing.value = true; result.value = ''
  let bid = targetBookId.value

  // 新建单词本
  if (bid === '__new__') {
    const nb = await $fetch<{ id: string }>('/api/wordbooks', { method: 'POST', body: { name: newBookName.value.trim() } })
    bid = nb.id
  }

  try {
    const res = await $fetch<{ inserted: number; total: number }>(`/api/wordbooks/${bid}/words/import`, {
      method: 'POST',
      body: { words: importWords.value, enrich: true },
    })
    result.value = `成功导入 ${res.inserted}/${res.total} 词 (AI 已补全音标/释义)`
    setTimeout(() => emit('done'), 1500)
  } catch (e: any) {
    result.value = '导入失败: ' + (e?.message || '')
  } finally {
    importing.value = false
  }
}
</script>

<style scoped>
.wim-overlay { position: fixed; inset: 0; z-index: 2000; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; }
.wim-modal { background: #fff; border-radius: 14px; padding: 24px; width: 92%; max-width: 440px; font-family: 'DM Sans', sans-serif; }
.wim-modal h3 { font-size: 16px; font-weight: 600; margin-bottom: 16px; }

.wim-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
.wim-tabs button { padding: 6px 16px; border: 1px solid #e0ddd5; border-radius: 6px; background: #fff; cursor: pointer; font-size: 13px; }
.wim-tabs button.active { background: #3d3591; color: #fff; border-color: #3d3591; }

.wim-textarea { width: 100%; height: 160px; padding: 12px; border: 1px solid #e0ddd5; border-radius: 8px; font-size: 14px; font-family: 'DM Mono', monospace; resize: none; outline: none; }
.wim-file-preview { border: 1px solid #e0ddd5; border-radius: 8px; padding: 12px; }
.wim-words-scroll { max-height: 140px; overflow-y: auto; display: flex; flex-wrap: wrap; gap: 6px; }
.wim-word-tag { padding: 3px 8px; background: #f0efe9; border-radius: 4px; font-size: 13px; }
.wim-file-preview p { font-size: 12px; color: #aaa; margin-top: 8px; }

.wim-target { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 14px; }
.wim-target label { font-size: 13px; color: #888; }
.wim-select { padding: 6px 10px; border: 1px solid #e0ddd5; border-radius: 6px; font-size: 13px; outline: none; }
.wim-input { padding: 6px 10px; border: 1px solid #e0ddd5; border-radius: 6px; font-size: 13px; outline: none; width: 120px; }

.wim-actions { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }
.wim-actions button { padding: 8px 18px; border: 1px solid #e0ddd5; border-radius: 8px; background: #fff; cursor: pointer; font-size: 14px; }
.wim-primary { background: #3d3591 !important; color: #fff !important; border: none !important; display: flex; align-items: center; gap: 6px; }
.wim-primary:disabled { opacity: 0.4; }
.wim-result { margin-top: 12px; font-size: 13px; color: #27ae60; }
.spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.6s linear infinite; display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
