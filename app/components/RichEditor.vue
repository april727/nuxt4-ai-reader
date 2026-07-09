<template>
  <div class="re-root" v-if="editor">
    <!-- 工具栏 -->
    <div class="re-toolbar">
      <!-- 文本格式 -->
      <div class="re-tb-group">
        <button class="re-tb-btn" :class="{ active: editor.isActive('bold') }" @click="editor.chain().focus().toggleBold().run()" title="粗体 (Ctrl+B)"><b>B</b></button>
        <button class="re-tb-btn" :class="{ active: editor.isActive('italic') }" @click="editor.chain().focus().toggleItalic().run()" title="斜体 (Ctrl+I)"><i>I</i></button>
        <button class="re-tb-btn" :class="{ active: editor.isActive('underline') }" @click="editor.chain().focus().toggleUnderline().run()" title="下划线 (Ctrl+U)"><u>U</u></button>
        <button class="re-tb-btn" :class="{ active: editor.isActive('strike') }" @click="editor.chain().focus().toggleStrike().run()" title="删除线"><s>S</s></button>
      </div>
      <span class="re-tb-sep" />
      <!-- 标题 -->
      <div class="re-tb-group">
        <button class="re-tb-btn" :class="{ active: editor.isActive('heading', { level: 1 }) }" @click="editor.chain().focus().toggleHeading({ level: 1 }).run()" title="标题1">H1</button>
        <button class="re-tb-btn" :class="{ active: editor.isActive('heading', { level: 2 }) }" @click="editor.chain().focus().toggleHeading({ level: 2 }).run()" title="标题2">H2</button>
        <button class="re-tb-btn" :class="{ active: editor.isActive('heading', { level: 3 }) }" @click="editor.chain().focus().toggleHeading({ level: 3 }).run()" title="标题3">H3</button>
      </div>
      <span class="re-tb-sep" />
      <!-- 颜色 -->
      <div class="re-tb-group">
        <div class="re-color-wrap">
          <button class="re-tb-btn re-color-btn" :class="{ active: editor.isActive('textStyle') }" title="文字颜色">
            <span class="re-color-letter">A</span>
            <span class="re-color-bar" :style="{ background: textColor }" />
          </button>
          <input type="color" class="re-color-input" :value="textColor" @input="editor.chain().focus().setColor($event.target.value).run()" />
        </div>
        <div class="re-color-wrap">
          <button class="re-tb-btn re-color-btn" :class="{ active: editor.isActive('highlight') }" title="背景高亮">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M15.23 2.53l-1.41 1.41 5.64 5.64 1.41-1.41-5.64-5.64zM4.5 19.5l5.65-5.65 5.65 5.65H4.5z"/></svg>
            <span class="re-color-bar" :style="{ background: highlightColor }" />
          </button>
          <input type="color" class="re-color-input" :value="highlightColor" @input="editor.chain().focus().toggleHighlight({ color: $event.target.value }).run()" />
        </div>
      </div>
      <span class="re-tb-sep" />
      <!-- 插入 -->
      <div class="re-tb-group">
        <button class="re-tb-btn" @click="addImage" title="插入图片">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </button>
        <button class="re-tb-btn" @click="editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()" title="插入表格">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
        </button>
        <button class="re-tb-btn" :class="{ active: editor.isActive('link') }" @click="toggleLink" title="链接">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </button>
      </div>
      <span class="re-tb-sep" />
      <!-- 列表 -->
      <div class="re-tb-group">
        <button class="re-tb-btn" :class="{ active: editor.isActive('bulletList') }" @click="editor.chain().focus().toggleBulletList().run()" title="无序列表">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>
        </button>
        <button class="re-tb-btn" :class="{ active: editor.isActive('orderedList') }" @click="editor.chain().focus().toggleOrderedList().run()" title="有序列表">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="3" y="8" font-size="9" fill="currentColor" stroke="none">1</text><text x="3" y="14" font-size="9" fill="currentColor" stroke="none">2</text><text x="3" y="20" font-size="9" fill="currentColor" stroke="none">3</text></svg>
        </button>
        <button class="re-tb-btn" :class="{ active: editor.isActive('blockquote') }" @click="editor.chain().focus().toggleBlockquote().run()" title="引用">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/></svg>
        </button>
      </div>
      <!-- 隐藏文件输入 -->
      <input ref="fileInputRef" type="file" accept="image/*" class="re-file-input" @change="onFileSelect" />
    </div>
    <!-- 编辑区 -->
    <editor-content class="re-content" :editor="editor" />
  </div>
</template>

<script setup lang="ts">
import { useEditor, EditorContent } from '@tiptap/vue-3'
import { StarterKit } from '@tiptap/starter-kit'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { Highlight } from '@tiptap/extension-highlight'
import { Image } from '@tiptap/extension-image'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { Underline } from '@tiptap/extension-underline'
import { Link } from '@tiptap/extension-link'
import { Placeholder } from '@tiptap/extension-placeholder'

const props = defineProps<{ modelValue?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const textColor = ref('#1a1a18')
const highlightColor = ref('#fff176')
const fileInputRef = ref<HTMLInputElement | null>(null)

function parseContent(val?: string) {
  if (!val) return null
  try { return JSON.parse(val) } catch { return null }
}

const editor = useEditor({
  content: parseContent(props.modelValue),
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
    }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    Image.configure({ inline: false, allowBase64: true }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    Underline,
    Link.configure({ openOnClick: false }),
    Placeholder.configure({ placeholder: '开始书写…' }),
  ],
  onUpdate: ({ editor }) => {
    emit('update:modelValue', JSON.stringify(editor.getJSON()))
  },
})

watch(() => props.modelValue, (val) => {
  if (!editor.value) return
  const current = JSON.stringify(editor.value.getJSON())
  if (val && val !== current) {
    editor.value.commands.setContent(parseContent(val) || '')
  }
})

async function addImage() {
  const input = fileInputRef.value
  if (!input) return
  input.value = ''
  input.click()
}

async function onFileSelect(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file || !editor.value) return

  const reader = new FileReader()
  reader.onload = async () => {
    const base64 = reader.result as string
    try {
      const { url } = await $fetch<{ url: string }>('/api/pages/upload', {
        method: 'POST',
        body: { image: base64 },
      })
      editor.value!.chain().focus().setImage({ src: url }).run()
    } catch (e: any) {
      // 回退：直接使用 base64
      editor.value!.chain().focus().setImage({ src: base64 }).run()
    }
  }
  reader.readAsDataURL(file)
}

function toggleLink() {
  if (!editor.value) return
  if (editor.value.isActive('link')) {
    editor.value.chain().focus().unsetLink().run()
  } else {
    const url = window.prompt('输入链接 URL:')
    if (url) editor.value.chain().focus().setLink({ href: url }).run()
  }
}

onBeforeUnmount(() => { editor.value?.destroy() })
</script>

<style scoped>
.re-root {
  display: flex; flex-direction: column; height: 100%; background: #fff;
}
.re-toolbar {
  display: flex; align-items: center; gap: 2px; padding: 6px 10px;
  border-bottom: 0.5px solid rgba(0,0,0,0.06); flex-shrink: 0; flex-wrap: wrap;
  background: #fafaf8;
}
.re-tb-group { display: flex; align-items: center; gap: 1px; }
.re-tb-sep { width: 0.5px; height: 16px; background: rgba(0,0,0,0.1); margin: 0 4px; }
.re-tb-btn {
  width: 26px; height: 26px; border: none; border-radius: 4px;
  background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center;
  font-size: 11px; color: #6b6963; font-family: 'DM Sans', sans-serif;
  transition: all 0.12s;
}
.re-tb-btn:hover { background: rgba(0,0,0,0.06); color: #1a1a18; }
.re-tb-btn.active { background: rgba(61,53,145,0.1); color: #3d3591; }
.re-color-wrap { position: relative; }
.re-color-btn { flex-direction: column; gap: 0; position: relative; }
.re-color-letter { font-size: 12px; font-weight: 600; line-height: 1; }
.re-color-bar { width: 8px; height: 2px; border-radius: 1px; }
.re-color-input {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  opacity: 0; cursor: pointer;
}
.re-file-input { display: none; }
.re-content {
  flex: 1; overflow-y: auto; padding: 20px 24px;
}
.re-content :deep(.ProseMirror) {
  outline: none; min-height: 100%; font-size: 14px; line-height: 1.85; color: #1a1a18;
  font-family: 'Lora', Georgia, serif;
}
.re-content :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder); color: #c0bdb4; float: left; pointer-events: none; height: 0;
}
.re-content :deep(.ProseMirror h1) { font-size: 1.6em; font-weight: 700; margin: 0.6em 0 0.3em; }
.re-content :deep(.ProseMirror h2) { font-size: 1.3em; font-weight: 600; margin: 0.5em 0 0.2em; }
.re-content :deep(.ProseMirror h3) { font-size: 1.1em; font-weight: 600; margin: 0.4em 0 0.15em; }
.re-content :deep(.ProseMirror ul), .re-content :deep(.ProseMirror ol) { padding-left: 1.5em; }
.re-content :deep(.ProseMirror blockquote) {
  border-left: 3px solid #3d3591; padding-left: 12px; margin: 0.5em 0; color: #6b6963;
}
.re-content :deep(.ProseMirror img) { max-width: 100%; border-radius: 6px; margin: 0.5em 0; }
.re-content :deep(.ProseMirror table) {
  border-collapse: collapse; width: 100%; margin: 0.5em 0;
}
.re-content :deep(.ProseMirror th) {
  background: #f0edfa; border: 0.5px solid rgba(61,53,145,0.2); padding: 6px 10px;
  font-weight: 600; text-align: left; font-size: 12px;
}
.re-content :deep(.ProseMirror td) {
  border: 0.5px solid rgba(0,0,0,0.1); padding: 6px 10px; font-size: 13px;
}
.re-content :deep(.ProseMirror a) { color: #3d3591; text-decoration: underline; }
.re-content :deep(.ProseMirror mark) { border-radius: 2px; padding: 0 2px; }
</style>
