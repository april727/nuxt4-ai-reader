<template>
  <div class="sc-wrap">
    <!-- 折叠条 -->
    <button class="sc-toggle" @click="expanded = !expanded">
      <span class="sc-toggle-label">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        与 AI 讨论字幕内容
      </span>
      <svg
        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        class="sc-chevron" :class="{ open: expanded }"
      ><polyline points="6 9 12 15 18 9"/></svg>
    </button>

    <Transition name="sc-expand">
      <div v-if="expanded" class="sc-panel">
        <!-- 快捷提问栏 -->
        <div class="sc-quick" v-if="messages.length === 0 && !loading">
          <button
            v-for="q in quickQuestions" :key="q.label"
            class="sc-quick-btn"
            :disabled="loading"
            @click="sendPreset(q.prompt)"
          >{{ q.label }}</button>
        </div>

        <!-- 消息列表 -->
        <div class="sc-messages" ref="msgListRef">
          <div v-for="(msg, i) in messages" :key="i" class="sc-msg" :class="msg.role">
            <div class="sc-bubble"><MarkdownRenderer :content="msg.content" /></div>
          </div>
          <div v-if="streaming" class="sc-msg ai">
            <div class="sc-bubble"><MarkdownRenderer :content="streamContent" /><span class="typing-cursor">|</span></div>
          </div>
          <div v-else-if="loading && !streaming" class="sc-msg ai">
            <div class="sc-bubble" style="color:#a09e97">思考中…</div>
          </div>
        </div>

        <!-- 输入区 -->
        <div class="sc-input-row">
          <input
            ref="inputRef"
            v-model="input"
            class="sc-input"
            placeholder="提问…"
            @keydown.enter="send"
            :disabled="loading"
          />
          <button class="sc-send" @click="send" :disabled="!input.trim() || loading">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import type { SubtitleCue } from '#shared/types'
import MarkdownRenderer from './MarkdownRenderer.vue'

const props = defineProps<{
  cues: SubtitleCue[]
  activeCueId: string | null
  title: string
}>()

const expanded = ref(false)
const input = ref('')
const loading = ref(false)
const streaming = ref(false)
const streamContent = ref('')
const messages = ref<Array<{ role: 'user' | 'assistant'; content: string }>>([])
const msgListRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)

const quickQuestions = [
  { label: '总结内容', prompt: '请用中文简要总结当前字幕内容讲了什么。' },
  { label: '解释难点', prompt: '当前字幕中有哪些值得学习的词汇或表达？请列出并解释。' },
  { label: '全文翻译', prompt: '请把当前可见的所有字幕翻译成流畅的中文。' },
  { label: '语法分析', prompt: '分析当前字幕中出现的重点语法结构。' },
]

// 构建上下文：全部字幕（标注当前播放位置）
const MAX_CONTEXT_CHARS = 12000
function buildContext(): string {
  const activeIdx = props.cues.findIndex(c => c.id === props.activeCueId)
  let lines = props.cues.map((c, i) => {
    const marker = i === activeIdx ? ' ▶' : ''
    return `[${formatTime(c.start)}]${marker} ${c.text}`
  })
  // 超长时保留首尾 + 中部截断，截断处标注省略
  let total = lines.join('\n')
  if (total.length > MAX_CONTEXT_CHARS) {
    const head = lines.slice(0, 30)
    const tail = lines.slice(-20)
    const midStart = Math.max(30, activeIdx - 15)
    const midEnd = Math.min(lines.length - 20, activeIdx + 15)
    const mid = midEnd > midStart ? lines.slice(midStart, midEnd) : []
    const parts: string[] = [...head]
    if (midStart > 30) parts.push(`... [省略 ${midStart - 30} 条字幕] ...`)
    if (mid.length) parts.push(...mid)
    if (midEnd < lines.length - 20) parts.push(`... [省略 ${lines.length - 20 - midEnd} 条字幕] ...`)
    parts.push(...tail)
    total = parts.join('\n')
  }
  return total
}
function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

async function send() {
  const text = input.value.trim()
  if (!text || loading.value) return
  input.value = ''
  messages.value.push({ role: 'user', content: text })
  loading.value = true
  streaming.value = true
  streamContent.value = ''
  scrollToBottom()

  const context = buildContext()
  const systemMsg = `你是专业的英语学习助手。用户正在观看/收听视频，以下是完整字幕内容（▶ 标记当前播放位置）。根据这些字幕回答用户问题。

视频标题：${props.title}

完整字幕：
${context}

回答要求：简洁、准确、聚焦学习价值。使用中文回答，涉及英文词汇时附带英文。可引用具体时间点（如 [2:35]）来定位讨论内容。`

  const msgs = [
    { role: 'system', content: systemMsg },
    ...messages.value.map(m => ({ role: m.role, content: m.content })),
  ]

  let full = ''
  try {
    const resp = await fetch('/api/deepseek/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: msgs }),
    })
    if (!resp.ok || !resp.body) throw new Error('Stream failed')
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      if (chunk) { full += chunk; streamContent.value = full }
    }
    messages.value.push({ role: 'assistant', content: full })
  } catch {
    messages.value.push({ role: 'assistant', content: '请求失败，请重试。' })
  } finally {
    streaming.value = false
    loading.value = false
    scrollToBottom()
  }
}

function sendPreset(prompt: string) {
  input.value = prompt
  nextTick(() => send())
}

function scrollToBottom() {
  nextTick(() => {
    if (msgListRef.value) msgListRef.value.scrollTop = msgListRef.value.scrollHeight
  })
}

watch(expanded, (v) => {
  if (v) nextTick(() => inputRef.value?.focus())
})
</script>

<style scoped>
.sc-wrap {
  border-top: 0.5px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}
.sc-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 14px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  color: #8a877c;
  font-size: 12px;
  transition: color 0.15s;
}
.sc-toggle:hover { color: #3d3591; }
.sc-toggle-label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sc-chevron {
  transition: transform 0.2s;
}
.sc-chevron.open { transform: rotate(180deg); }

.sc-panel {
  display: flex;
  flex-direction: column;
  max-height: 280px;
  min-height: 140px;
  border-top: 0.5px solid rgba(0, 0, 0, 0.04);
}

/* 快捷提问 */
.sc-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 10px 4px;
}
.sc-quick-btn {
  padding: 4px 10px;
  border: 1px solid rgba(61, 53, 145, 0.15);
  border-radius: 6px;
  background: #faf9fe;
  color: #3d3591;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s;
  white-space: nowrap;
}
.sc-quick-btn:hover { background: #edeafd; border-color: #3d3591; }
.sc-quick-btn:disabled { opacity: 0.4; cursor: default; }

/* 消息 */
.sc-messages {
  flex: 1;
  overflow-y: auto;
  padding: 8px 14px;
  min-height: 0;
  scrollbar-width: none;
}
.sc-messages::-webkit-scrollbar { display: none; }

.sc-msg {
  margin-bottom: 8px;
}
.sc-msg.user .sc-bubble {
  background: #edeafd;
  color: #3d3591;
  border-radius: 10px 10px 2px 10px;
  margin-left: auto;
  max-width: 85%;
  padding: 7px 12px;
  font-size: 12.5px;
  line-height: 1.55;
}
.sc-msg.ai .sc-bubble {
  background: #f5f4f2;
  color: #1a1a18;
  border-radius: 10px 10px 10px 2px;
  margin-right: auto;
  max-width: 95%;
  padding: 8px 12px;
  font-size: 12.5px;
  line-height: 1.65;
}
.sc-bubble :deep(p) { margin: 0 0 4px; }
.sc-bubble :deep(p:last-child) { margin-bottom: 0; }
.sc-bubble :deep(ul), .sc-bubble :deep(ol) { padding-left: 16px; margin: 4px 0; }
.sc-bubble :deep(code) {
  background: rgba(0,0,0,0.06);
  padding: 1px 4px; border-radius: 3px;
  font-size: 0.92em;
}

.typing-cursor {
  display: inline;
  color: #3d3591;
  animation: blink 0.8s infinite;
  font-weight: 100;
}
@keyframes blink { 0%,50%{opacity:1} 51%,100%{opacity:0} }

/* 输入 */
.sc-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-top: 0.5px solid rgba(0,0,0,0.06);
  flex-shrink: 0;
}
.sc-input {
  flex: 1;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 12.5px;
  font-family: inherit;
  outline: none;
  background: #fafaf8;
  color: #1a1a18;
}
.sc-input:focus { border-color: #3d3591; background: #fff; }
.sc-input::placeholder { color: #c0bdb4; }
.sc-send {
  width: 30px; height: 30px;
  border: none; border-radius: 8px;
  background: #3d3591; color: #fff;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s;
}
.sc-send:hover { background: #2f2875; }
.sc-send:disabled { opacity: 0.3; cursor: default; }

/* 展开动画 */
.sc-expand-enter-active {
  transition: all 0.25s ease-out;
}
.sc-expand-leave-active {
  transition: all 0.15s ease-in;
}
.sc-expand-enter-from,
.sc-expand-leave-to {
  max-height: 0;
  opacity: 0;
}
.sc-expand-enter-to,
.sc-expand-leave-from {
  max-height: 300px;
  opacity: 1;
}
</style>
