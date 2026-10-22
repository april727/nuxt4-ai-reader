<template>
  <div class="sticky-notes-wrapper">
    <h1 class="sn-title">📝 Sticky Notes</h1>

    <div class="sn-toolbar">
      <select v-model="selectedShape" class="sn-select">
        <option value="rectangle">📄 Rectangle</option>
        <option value="cloud">☁️ Cloud</option>
        <option value="circle">⭕ Circle</option>
        <option value="blob">🎨 Blob</option>
      </select>
      <button class="sn-btn" @click="handleAdd">Add Note</button>
      <button class="sn-btn sn-btn-danger" @click="handleClearAll">Clear All</button>
    </div>

    <div
      ref="containerRef"
      class="sn-container"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @mouseleave="handleMouseUp"
    >
      <div
        v-for="note in notes"
        :key="note.id"
        ref="noteEls"
        class="sn-note"
        :class="note.shape"
        :style="noteStyle(note)"
        @mousedown="handleNoteMouseDown($event, note)"
        @click="bringToFront(note.id)"
      >
        <!-- 胶带效果 -->
        <div class="sn-tape"></div>

        <!-- 励志名言 -->
        <div class="sn-quote">{{ note.quote }}</div>

        <!-- 控制按钮 -->
        <div class="sn-controls">
          <button class="sn-ctrl-btn" @click.stop="toggleEdit(note)">
            {{ editingId === note.id ? '👁️ View' : '✏️ Edit' }}
          </button>
          <button class="sn-ctrl-btn" @click.stop="saveNote(note)">💾 Save</button>
          <button class="sn-ctrl-btn" @click.stop="deleteNote(note.id)">🗑️ Del</button>
        </div>

        <!-- 文本区域 -->
        <textarea
          class="sn-textarea"
          :value="note.text"
          :disabled="editingId !== note.id"
          placeholder="Write your note here..."
          @input="onTextInput($event, note.id)"
          @click.stop
        />

        <!-- 颜色选择器 -->
        <input
          type="color"
          class="sn-color-picker"
          :value="note.color"
          @input="onColorChange($event, note.id)"
          @click.stop
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useStickyNotes, type StickyNote, type NoteShape } from '~/composables/useStickyNotes'

const {
  notes,
  addNote,
  deleteNote,
  clearAll,
  updateNote,
  bringToFront,
  startDrag,
  onDragMove,
  endDrag,
  draggingId,
} = useStickyNotes()

const selectedShape = ref<NoteShape>('rectangle')
const editingId = ref<number | null>(null)
const containerRef = ref<HTMLElement | null>(null)
const noteEls = ref<HTMLElement[]>([])

// ---- 样式计算 ----
function noteStyle(note: StickyNote) {
  const isDragging = draggingId.value === note.id
  const isEditing = editingId.value === note.id
  const rotation = isDragging || isEditing ? 0 : note.rotation
  return {
    left: note.left,
    top: note.top,
    background: note.color,
    zIndex: note.zIndex,
    transform: `rotate(${rotation}deg)`,
    boxShadow: isDragging
      ? '0 10px 20px rgba(0,0,0,0.3)'
      : '0 4px 8px rgba(0,0,0,0.2)',
  }
}

// ---- 操作 ----
function handleAdd() {
  addNote(selectedShape.value)
}

function handleClearAll() {
  if (confirm('Are you sure you want to delete all notes?')) {
    clearAll()
    editingId.value = null
  }
}

function toggleEdit(note: StickyNote) {
  editingId.value = editingId.value === note.id ? null : note.id
}

function saveNote(note: StickyNote) {
  editingId.value = null
  updateNote(note.id, { text: note.text })
}

function onTextInput(e: Event, id: number) {
  const target = e.target as HTMLTextAreaElement
  updateNote(id, { text: target.value })
}

function onColorChange(e: Event, id: number) {
  const target = e.target as HTMLInputElement
  updateNote(id, { color: target.value })
}

// ---- 拖拽 ----
function handleNoteMouseDown(e: MouseEvent, note: StickyNote) {
  const target = e.target as HTMLElement
  if (['TEXTAREA', 'BUTTON', 'INPUT'].includes(target.tagName)) return
  e.preventDefault()
  const el = (e.currentTarget as HTMLElement)
  startDrag(note.id, e.clientX, e.clientY, el)
}

function handleMouseMove(e: MouseEvent) {
  if (!containerRef.value || draggingId.value === null) return
  const rect = containerRef.value.getBoundingClientRect()
  onDragMove(e.clientX, e.clientY, rect)
}

function handleMouseUp() {
  endDrag()
}
</script>

<style scoped>
.sticky-notes-wrapper {
  font-family: 'Comic Sans MS', 'Marker Felt', 'Segoe Print', sans-serif;
  margin: 20px;
  background: #f5f5f5 url('https://www.transparenttextures.com/patterns/notebook.png');
  min-height: 100vh;
  padding: 20px;
  box-sizing: border-box;
}

.sn-title {
  text-align: center;
  margin-bottom: 20px;
  color: #333;
  text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.1);
}

.sn-toolbar {
  text-align: center;
  margin-bottom: 30px;
}

.sn-btn,
.sn-select {
  margin: 5px;
  padding: 10px 15px;
  font-size: 14px;
  cursor: pointer;
  border: none;
  border-radius: 4px;
  background: #fff;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
  transition: all 0.2s ease;
  font-family: inherit;
}

.sn-btn:hover,
.sn-select:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

.sn-btn-danger:hover {
  background: #ffebee;
}

.sn-container {
  position: relative;
  width: 100%;
  min-height: 80vh;
  border: 1px solid #ddd;
  background: #fff url('https://www.transparenttextures.com/patterns/cork-board.png');
  overflow: auto;
  padding: 20px;
  box-sizing: border-box;
}

/* ---- 便签基础样式 ---- */
.sn-note {
  position: absolute;
  width: 220px;
  min-height: 200px;
  padding: 15px;
  box-sizing: border-box;
  cursor: move;
  transition: box-shadow 0.3s ease;
  animation: sn-appear 0.5s ease-out;
  overflow: hidden;
  user-select: none;
}

.sn-note:hover {
  transform: rotate(1deg) scale(1.02) !important;
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.25) !important;
}

/* 胶带效果 */
.sn-tape {
  position: absolute;
  top: -5px;
  left: 50%;
  transform: translateX(-50%);
  width: 60px;
  height: 15px;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 2px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  z-index: 1;
}

/* 折角效果 */
.sn-note::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 30px;
  height: 30px;
  background: linear-gradient(135deg, rgba(0, 0, 0, 0.1) 0%, rgba(0, 0, 0, 0) 50%);
  pointer-events: none;
}

.sn-quote {
  font-size: 12px;
  font-style: italic;
  color: #666;
  margin-bottom: 10px;
  border-bottom: 1px dashed #ccc;
  padding-bottom: 5px;
}

.sn-controls {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  gap: 4px;
}

.sn-ctrl-btn {
  font-size: 12px;
  padding: 5px 8px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 3px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  flex: 1;
  font-family: inherit;
}

.sn-ctrl-btn:hover {
  background: rgba(255, 255, 255, 0.9);
}

.sn-textarea {
  width: 100%;
  height: 120px;
  resize: none;
  border: none;
  outline: none;
  font-size: 14px;
  font-family: 'Comic Sans MS', 'Marker Felt', 'Segoe Print', sans-serif;
  background: transparent;
  margin-top: 10px;
  line-height: 1.4;
}

.sn-textarea:disabled {
  cursor: default;
}

.sn-color-picker {
  width: 30px;
  height: 30px;
  border: none;
  cursor: pointer;
  background: transparent;
  position: absolute;
  bottom: 5px;
  right: 5px;
  padding: 0;
}

/* ---- 形状 ---- */
.sn-note.rectangle {
  border-radius: 2px;
}

.sn-note.circle {
  border-radius: 50%;
  padding: 25px;
  width: 250px;
  height: 250px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.sn-note.cloud {
  border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15);
}

.sn-note.blob {
  border-radius: 70% 30% 60% 40% / 60% 40% 60% 40%;
}

/* ---- 动画 ---- */
@keyframes sn-appear {
  0% {
    transform: scale(0.8) rotate(-5deg);
    opacity: 0;
  }
  100% {
    transform: scale(1) rotate(0);
    opacity: 1;
  }
}

/* ---- 响应式 ---- */
@media (max-width: 600px) {
  .sn-note {
    width: 180px;
    min-height: 160px;
  }
  .sn-textarea {
    height: 100px;
  }
}
</style>