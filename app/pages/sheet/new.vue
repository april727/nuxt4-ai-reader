<template>
  <div class="sn">
    <header class="sn-head">
      <button class="sn-back" @click="navigateTo('/resources')">←</button>
      <h1>新建图片试卷</h1>
    </header>

    <div class="sn-body">
      <div
        class="drop"
        :class="{ over: dragging }"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
        @click="pick"
      >
        <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onPick" />
        <div class="drop-ic">＋</div>
        <p class="drop-main">点击选择，或把试卷图片拖进来</p>
        <p class="drop-sub">支持一次多页 · JPG / PNG / WebP · 单次最多 30 张</p>
      </div>

      <div v-if="items.length" class="previews">
        <div v-for="(it, i) in items" :key="it.key" class="pv">
          <span class="pv-no">{{ i + 1 }}</span>
          <img :src="it.url" alt="" />
          <button class="pv-del" title="移除" @click="removeAt(i)">×</button>
          <span class="pv-size">{{ fmtSize(it.size) }}</span>
        </div>
      </div>

      <div class="sn-form">
        <label class="fld">
          <span>标题</span>
          <input v-model="title" placeholder="例如：八年级数学 第 8 周单元测" spellcheck="false" />
        </label>
        <div class="sn-actions">
          <span v-if="error" class="err">{{ error }}</span>
          <span v-else-if="totalSize" class="total">共 {{ items.length }} 页 · {{ fmtSize(totalSize) }}</span>
          <button class="go" :disabled="!items.length || uploading" @click="submit">
            {{ uploading ? '上传中…' : '创建并开始标注' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import { compressImageFile } from '~/utils/imageCompress'

const fileInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)
const uploading = ref(false)
const error = ref('')
const title = ref('')

interface Item { key: string; file: File; ready: Promise<File>; url: string; size: number }
const items = ref<Item[]>([])

const totalSize = computed(() => items.value.reduce((s, it) => s + it.size, 0))

function fmtSize(n: number) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function pick() {
  fileInput.value?.click()
}

/** 相机拍的图常是 IMG_2 / IMG_10，按自然序排才不会把第 10 页排到第 2 页前 */
function sortByName(a: File, b: File) {
  return a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
}

function addFiles(list: FileList | File[]) {
  error.value = ''
  const imgs = Array.from(list).filter(f => f.type.startsWith('image/'))
  const room = 30 - items.value.length
  if (room <= 0) { error.value = '单次最多 30 张'; return }
  const take = imgs.slice(0, room).sort(sortByName)
  for (const f of take) {
    items.value.push({
      key: `${f.name}_${f.size}_${Math.random().toString(36).slice(2, 6)}`,
      file: f,
      // 手机拍照动辄 5–8MB，先在本地压到 ~900KB；试卷要看清小题文字，
      // 所以长边给到 2400（比阅读贴图的 1280 高一档），压缩失败则原图直传
      ready: compressImageFile(f, { maxEdge: 2400, quality: 0.86, maxBytes: 900 * 1024 })
        .then(out => (out instanceof File ? out : new File([out], f.name, { type: out.type })))
        .catch(() => f),
      url: URL.createObjectURL(f),
      size: f.size,
    })
  }
  if (imgs.length > room) error.value = `超出上限，已忽略 ${imgs.length - room} 张`
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) addFiles(input.files)
  input.value = ''
}

function onDrop(e: DragEvent) {
  dragging.value = false
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
}

function removeAt(i: number) {
  const it = items.value[i]
  if (it) URL.revokeObjectURL(it.url)
  items.value.splice(i, 1)
}

async function submit() {
  if (!items.value.length || uploading.value) return
  uploading.value = true
  error.value = ''
  try {
    const fd = new FormData()
    fd.append('title', title.value.trim())
    for (const it of items.value) {
      const f = await it.ready
      fd.append('file', f, f.name)
    }
    const res = await $fetch<{ id: string }>('/api/sheet/create', { method: 'POST', body: fd })
    items.value.forEach(it => URL.revokeObjectURL(it.url))
    await navigateTo(`/sheet/${res.id}`)
  } catch (e: any) {
    error.value = e?.data?.message || e?.statusMessage || '上传失败，请重试'
  } finally {
    uploading.value = false
  }
}

onBeforeUnmount(() => items.value.forEach(it => URL.revokeObjectURL(it.url)))
</script>

<style scoped>
.sn { min-height: 100vh; background: #f7f6f3; font-family: 'DM Sans', sans-serif; color: #1a1a18; }
.sn-head {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 20px; border-bottom: 0.5px solid rgba(0, 0, 0, 0.08); background: #fff;
}
.sn-back {
  border: 0.5px solid rgba(0, 0, 0, 0.12); background: transparent; cursor: pointer;
  width: 26px; height: 26px; border-radius: 7px; font-size: 13px; color: #4a4843;
}
.sn-back:hover { background: #f5f4f0; }
.sn-head h1 { font-family: 'Lora', Georgia, serif; font-size: 15px; font-weight: 500; margin: 0; }

.sn-body { max-width: 760px; margin: 0 auto; padding: 22px 20px 60px; }

.drop {
  border: 1px dashed rgba(61, 53, 145, 0.32); border-radius: 14px;
  background: #fff; padding: 34px 20px; text-align: center; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.drop:hover, .drop.over { background: #f8f7ff; border-color: rgba(61, 53, 145, 0.6); }
.drop-ic { font-size: 22px; color: #3d3591; line-height: 1; }
.drop-main { font-size: 13.5px; margin: 10px 0 4px; }
.drop-sub { font-size: 11.5px; color: #a09e97; margin: 0; }

.previews {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 10px; margin-top: 16px;
}
.pv { position: relative; border-radius: 9px; overflow: hidden; background: #fff; border: 0.5px solid rgba(0, 0, 0, 0.1); }
.pv img { display: block; width: 100%; height: 132px; object-fit: cover; }
.pv-no {
  position: absolute; top: 5px; left: 5px; z-index: 1;
  background: rgba(26, 26, 24, 0.72); color: #fff; font-size: 10px;
  border-radius: 4px; padding: 1px 5px; font-family: 'DM Mono', monospace;
}
.pv-del {
  position: absolute; top: 4px; right: 4px; z-index: 1;
  width: 18px; height: 18px; border-radius: 50%; border: none; cursor: pointer;
  background: rgba(26, 26, 24, 0.6); color: #fff; font-size: 12px; line-height: 1;
}
.pv-del:hover { background: #a32d2d; }
.pv-size {
  position: absolute; bottom: 0; left: 0; right: 0;
  background: rgba(26, 26, 24, 0.55); color: #fff; font-size: 9.5px;
  padding: 2px 5px; text-align: right;
}

.sn-form { margin-top: 20px; }
.fld { display: block; }
.fld span { display: block; font-size: 12px; color: #6b6862; margin-bottom: 6px; }
.fld input {
  width: 100%; box-sizing: border-box;
  border: 0.5px solid rgba(0, 0, 0, 0.14); border-radius: 9px;
  padding: 9px 11px; font-family: inherit; font-size: 13.5px; outline: none; background: #fff;
}
.fld input:focus { border-color: rgba(61, 53, 145, 0.45); }

.sn-actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 16px; }
.err { font-size: 12px; color: #a32d2d; }
.total { font-size: 11.5px; color: #a09e97; }
.go {
  border: none; cursor: pointer; border-radius: 9px; padding: 9px 18px;
  background: #3d3591; color: #fff; font-family: inherit; font-size: 13px;
}
.go:disabled { opacity: 0.45; cursor: default; }
</style>
