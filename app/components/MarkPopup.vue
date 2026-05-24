<template>
  <Teleport to="body">
    <div v-if="visible" class="mark-popup" :style="popupStyle" ref="popupRef">
      <div class="mp-header" :style="{ background: mark.color }" @mousedown="startDrag">
        <span class="mp-type">{{ typeLabel }}</span>
        <div class="mp-header-actions">
          <button class="mp-btn-icon mp-delete" @click.stop="handleDelete" title="删除"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
          <button class="mp-btn-icon" @click.stop="toggleExpand">{{ expanded ? '−' : '+' }}</button>
          <button class="mp-btn-icon mp-close-btn" @click.stop="close">×</button>
        </div>
      </div>
      <div v-if="expanded" class="mp-body">
        <div v-if="loading && !typing" class="mp-loading"><div class="spinner-sm"></div>AI 正在分析...</div>
        <div class="mp-word-row" :style="{ borderLeftColor: mark.color }">
          <span class="mp-word-text">{{ mark.text }}<span v-if="mark.lemma && mark.lemma !== mark.text" class="mp-lemma">({{ mark.lemma }})</span></span>
          <template v-if="mark.type === 'word'">
            <span v-if="phonetic" class="mp-phonetic">{{ phonetic }}</span>
            <button class="mp-play-btn" :class="{ playing: isPlaying }" @click="doPronounce"><span v-if="isPlaying" class="playing-bars"><span></span><span></span><span></span></span><svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></button>
          </template>
        </div>
        <div v-if="typing && typingContent" class="mp-detail"><MarkdownRenderer :content="typingContent" /><span class="tc-typing">|</span></div>
        <div v-else-if="mark.detail" class="mp-detail"><MarkdownRenderer :content="displayDetail" /></div>
        <div class="mp-note"><textarea v-model="localNote" class="mp-note-input" placeholder="笔记..." rows="2" @blur="saveNote"></textarea></div>
      </div>
      <div v-if="expanded" class="mp-resize-handle" @mousedown="startResize"></div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { Mark } from '#shared/types'

const props = defineProps<{ visible: boolean; mark: Mark; loading: boolean; typing: boolean; typingContent: string; position: { x: number; y: number } }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'update-note', n: string): void; (e: 'delete'): void; (e: 'pronounce', w: string): void }>()

const expanded = ref(true); const localNote = ref(''); const popupX = ref(0); const popupY = ref(0); const popupW = ref(380); const popupH = ref(420); const isPlaying = ref(false)
let playTimer: any = null

const phonetic = computed(() => { if (!props.mark.detail) return ''; const m = props.mark.detail.match(/\[PHONETIC\]\s*(\/[^/]+\/)\s*\[\/PHONETIC\]/); if (m) return m[1]; const m2 = props.mark.detail.match(/\/([^/\n]{2,40})\//); return m2 ? m2[0] : '' })
const displayDetail = computed(() => { if (!props.mark.detail) return ''; let d = props.mark.detail; d = d.replace(/\[PHONETIC\]\s*\/[^/]+\/\s*\[\/PHONETIC\]\n?/gi, ''); d = d.replace(/###\s*音标\s*\n\s*\/[^/]+\/[^\n]*\n?/gi, ''); d = d.replace(/\[LEMMA[\s\S]*?\[\/LEMMA\]\n?/gi, ''); return d.trim() })
const typeLabel = computed(() => ({ word: '生词', phrase: '短语', sentence: '句子' } as any)[props.mark.type] || '标记')

watch(() => props.visible, (v) => { if (v) { popupX.value = Math.min(props.position.x, window.innerWidth - 400); popupY.value = Math.min(props.position.y, window.innerHeight - 440); localNote.value = props.mark.note || '' } })
function doPronounce() { if (isPlaying.value) return; isPlaying.value = true; const w = props.mark.lemma || props.mark.text; emit('pronounce', w); playTimer = setTimeout(() => { isPlaying.value = false }, 2500) }
function handleDelete() { emit('delete') }
function close() { emit('close') }
function toggleExpand() { expanded.value = !expanded.value }
function saveNote() { if (localNote.value !== props.mark.note) emit('update-note', localNote.value) }

let dragging = false; let dx = 0; let dy = 0
function startDrag(e: MouseEvent) { dragging = true; dx = e.clientX - popupX.value; dy = e.clientY - popupY.value; document.addEventListener('mousemove', onDrag); document.addEventListener('mouseup', stopDrag) }
function onDrag(e: MouseEvent) { if (!dragging) return; popupX.value = Math.max(0, Math.min(e.clientX - dx, window.innerWidth - 100)); popupY.value = Math.max(0, Math.min(e.clientY - dy, window.innerHeight - 60)) }
function stopDrag() { dragging = false; document.removeEventListener('mousemove', onDrag); document.removeEventListener('mouseup', stopDrag) }
let resizing = false; let rx = 0; let ry = 0
function startResize(e: MouseEvent) { e.stopPropagation(); resizing = true; rx = e.clientX; ry = e.clientY; document.addEventListener('mousemove', onResize); document.addEventListener('mouseup', stopResize) }
function onResize(e: MouseEvent) { if (!resizing) return; popupW.value = Math.max(300, popupW.value + e.clientX - rx); popupH.value = Math.max(250, popupH.value + e.clientY - ry); rx = e.clientX; ry = e.clientY }
function stopResize() { resizing = false; document.removeEventListener('mousemove', onResize); document.removeEventListener('mouseup', stopResize) }
onUnmounted(() => { stopDrag(); stopResize(); if (playTimer) clearTimeout(playTimer) })
const popupStyle = computed(() => ({ left: `${popupX.value}px`, top: `${popupY.value}px`, width: `${popupW.value}px`, height: expanded.value ? `${popupH.value}px` : 'auto' }))
</script>

<style scoped>
.mark-popup { position: fixed; z-index: 3000; background: #ffffff; border-radius: 14px; box-shadow: 0 16px 48px rgba(0,0,0,0.22); overflow: hidden; display: flex; flex-direction: column; }
.mp-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; color: #ffffff; cursor: grab; flex-shrink: 0; }
.mp-header:active { cursor: grabbing; }
.mp-type { font-size: 12px; font-weight: 600; letter-spacing: 0.04em; }
.mp-header-actions { display: flex; gap: 2px; }
.mp-btn-icon { width: 26px; height: 26px; border: none; border-radius: 6px; background: rgba(255,255,255,0.2); color: #ffffff; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.mp-btn-icon:hover { background: rgba(255,255,255,0.35); }
.mp-delete:hover { background: rgba(239,68,68,0.5) !important; }
.mp-close-btn:hover { background: rgba(239,68,68,0.5) !important; }
.mp-body { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.mp-loading { display: flex; align-items: center; gap: 8px; color: #64748b; font-size: 13px; }
.mp-word-row { display: flex; align-items: center; gap: 8px; border-left: 3px solid; padding-left: 10px; }
.mp-word-text { font-size: 1.15em; font-weight: 600; color: #1e293b; }
.mp-phonetic { font-family: 'Georgia', serif; font-size: 0.95em; color: #6366f1; }
.mp-word-text .mp-lemma { font-size: inherit; color: #8b5cf6; font-weight: 400; }
.mp-play-btn { display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 1.5px solid #6366f1; border-radius: 50%; background: transparent; color: #6366f1; cursor: pointer; transition: all 0.15s; flex-shrink: 0; }
.mp-play-btn:hover { background: #eef2ff; }
.mp-play-btn.playing { background: #eef2ff; border-color: #818cf8; }
.playing-bars { display: flex; align-items: flex-end; gap: 2px; height: 11px; }
.playing-bars span { width: 2px; background: #6366f1; border-radius: 1px; animation: barAnim 0.7s infinite ease-in-out alternate; }
.playing-bars span:nth-child(1) { height: 6px; animation-delay: 0s; }
.playing-bars span:nth-child(2) { height: 11px; animation-delay: 0.12s; }
.playing-bars span:nth-child(3) { height: 8px; animation-delay: 0.24s; }
@keyframes barAnim { from { transform: scaleY(0.4); opacity: 0.4; } to { transform: scaleY(1); opacity: 1; } }
.mp-detail { font-size: 0.88em; }
.tc-typing { display: inline; color: #6366f1; animation: blink 0.8s infinite; }
@keyframes blink { 0%,50%{opacity:1} 51%,100%{opacity:0} }
.mp-note { border-top: 1px solid #f1f5f9; padding-top: 8px; }
.mp-note-input { width: 100%; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 8px; font-family: inherit; font-size: 12px; resize: vertical; outline: none; background: #fafbfc; }
.mp-note-input:focus { border-color: #6366f1; background: #ffffff; }
.mp-resize-handle { position: absolute; bottom: 0; right: 0; width: 16px; height: 16px; cursor: nwse-resize; }
.mp-resize-handle::after { content: ''; position: absolute; bottom: 4px; right: 4px; width: 8px; height: 8px; border-right: 2px solid #cbd5e1; border-bottom: 2px solid #cbd5e1; }
.spinner-sm { width: 14px; height: 14px; border: 2px solid #e2e8f0; border-top-color: #6366f1; border-radius: 50%; animation: spin 0.6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
