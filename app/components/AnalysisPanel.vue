<template>
  <div class="analysis-panel">
    <div class="ap-header">
      <span class="ap-label">理解</span>
    </div>

    <div class="ap-content" ref="contentEl" @click="handleContentClick" :style="contentStyle">
      <div v-if="isWaiting" class="ap-waiting">
        <div class="waiting-dots"><span></span><span></span><span></span></div>
        <p>AI 正在分析，请稍候...</p>
      </div>
      <div v-else-if="content || isTyping || displayedContent" class="ap-markdown">
        <MarkdownRenderer :content="displayedContent" />
        <div v-if="isTyping" class="typing-cursor">|</div>
      </div>
      <div v-else class="ap-empty">
        <p>点击段落或悬停后点「理解」查看分析</p>
      </div>
    </div>

    <div class="ap-divider" @mousedown="startDrag"></div>

    <!-- 对话历史（可滚动，input 固定下方） -->
    <div class="ap-chat-area">
      <div v-if="chatMessages.length > 0" class="ap-chat-history" ref="chatHistoryEl">
        <div v-for="(msg, i) in chatMessages" :key="i" class="chat-msg" :class="msg.role">
          <div class="chat-msg-role">{{ msg.role === 'user' ? '你' : 'AI' }}</div>
          <div class="chat-msg-content">
            <template v-if="msg.role === 'assistant'">
              <MarkdownRenderer v-if="!chatTyping || i < chatMessages.length - 1" :content="msg.content" />
            </template>
            <p v-else>{{ msg.content }}</p>
          </div>
        </div>
        <div v-if="chatTyping && typingChatContent" class="chat-msg assistant">
          <div class="chat-msg-role">AI</div>
          <div class="chat-msg-content"><MarkdownRenderer :content="typingChatContent" /><span class="typing-cursor">|</span></div>
        </div>
        <div v-if="chatLoading && !chatTyping" class="chat-msg assistant">
          <div class="chat-msg-role">AI</div>
          <div class="chat-loading"><span class="dot-blink">●</span><span class="dot-blink">●</span><span class="dot-blink">●</span></div>
        </div>
      </div>
    </div>

    <!-- 输入框 — 绝对定位固定在底部 -->
    <div class="ap-chat-input">
      <input v-model="chatInput" class="chat-input-field" placeholder="提问关于当前段落的问题..." @keydown.enter="sendChat" :disabled="chatLoading" />
      <button class="chat-send-btn" :disabled="!chatInput.trim() || chatLoading" @click="sendChat">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ChatMessage } from '#shared/types'

const props = defineProps<{
  content: string; isTyping: boolean; displayedContent: string
  chatMessages: ChatMessage[]; chatLoading: boolean; chatTyping: boolean
  typingChatContent: string; isWaiting: boolean
}>()

const emit = defineEmits<{ (e: 'send-chat', message: string): void; (e: 'finish-typing'): void }>()

const chatInput = ref(''); const contentEl = ref<HTMLElement | null>(null)
const chatHistoryEl = ref<HTMLElement | null>(null)
const manualH = ref<number | null>(null)
let dragging = false

const contentStyle = computed(() => {
  if (manualH.value !== null) return { height: manualH.value + 'px', flex: 'none' }
  return {}
})

watch(() => props.chatMessages.length, () => nextTick(scrollChat))
watch(() => props.typingChatContent, () => nextTick(scrollChat))
function scrollChat() { if (chatHistoryEl.value) chatHistoryEl.value.scrollTop = chatHistoryEl.value.scrollHeight }

function sendChat() { const t = chatInput.value.trim(); if (!t || props.chatLoading) return; emit('send-chat', t); chatInput.value = '' }
function handleContentClick() { if (props.isTyping) emit('finish-typing') }

function startDrag(e: MouseEvent) {
  dragging = true; const sy = e.clientY
  const el = contentEl.value; const sh = el ? el.getBoundingClientRect().height : 300
  document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none'
  const onMove = (ev: MouseEvent) => { if (!dragging) return; manualH.value = Math.max(0, Math.min(sh + ev.clientY - sy, window.innerHeight - 200)) }
  const onUp = () => { dragging = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
}

onUnmounted(() => { document.body.style.cursor = ''; document.body.style.userSelect = '' })
</script>

<style scoped>
.analysis-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; position: relative; padding-bottom: 52px; box-sizing: border-box; }
.ap-header { display: flex; align-items: center; padding: 0 20px; height: 44px; border-bottom: 1px solid #e8ecf1; background: #fafbfc; flex-shrink: 0; }
.ap-label { font-size: 13px; font-weight: 600; color: #64748b; }

.ap-content { flex: 5 1 0%; overflow-y: auto; padding: 0 20px; min-height: 0; box-shadow: 0 3px 14px rgba(0,0,0,0.08); position: relative; z-index: 1; }
.ap-markdown { padding: 16px 0; font-size: 0.92em; }

.ap-waiting { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; text-align: center; color: #64748b; gap: 16px; }
.waiting-dots { display: flex; gap: 6px; }
.waiting-dots span { width: 10px; height: 10px; border-radius: 50%; background: #6366f1; animation: dotPulse 1.2s infinite ease-in-out; }
.waiting-dots span:nth-child(2) { animation-delay: 0.2s; }
.waiting-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes dotPulse { 0%,80%,100%{opacity:0.3;transform:scale(0.8)} 40%{opacity:1;transform:scale(1.1)} }
.ap-empty { padding: 40px; text-align: center; color: #94a3b8; }

.ap-divider { height: 6px; flex-shrink: 0; cursor: row-resize; background: #e8ecf1; transition: background 0.15s; }
.ap-divider:hover,.ap-divider:active { background: #818cf8; }

/* 对话历史 */
.ap-chat-area { flex-shrink: 0; overflow-y: auto; }
.ap-chat-history { padding: 8px 16px; }
.chat-msg { margin-bottom: 10px; }
.chat-msg-role { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #94a3b8; margin-bottom: 2px; }
.chat-msg.user .chat-msg-role { color: #6366f1; }
.chat-msg-content { font-size: 0.85em; line-height: 1.6; color: #334155; }
.chat-loading .dot-blink { animation: dotBlink 1.4s infinite; color: #6366f1; margin: 0 2px; }
.dot-blink:nth-child(2) { animation-delay: 0.2s; }
.dot-blink:nth-child(3) { animation-delay: 0.4s; }
@keyframes dotBlink { 0%,80%,100%{opacity:0.3} 40%{opacity:1} }

/* 输入框 — 绝对定位固定底部 */
.ap-chat-input { position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-top: 1px solid #e8ecf1; background: #ffffff; }
.chat-input-field { flex: 1; padding: 8px 14px; border: 1px solid #e2e8f0; border-radius: 18px; font-size: 13px; background: #f8fafc; outline: none; }
.chat-input-field:focus { border-color: #6366f1; background: #ffffff; }
.chat-send-btn { width: 32px; height: 32px; border: none; border-radius: 50%; background: #6366f1; color: #ffffff; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.chat-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.typing-cursor { display: inline; color: #6366f1; animation: blink 0.8s infinite; font-weight: 100; }
@keyframes blink { 0%,50%{opacity:1} 51%,100%{opacity:0} }
</style>
