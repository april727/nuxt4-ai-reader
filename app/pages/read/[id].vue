<template>
  <div class="read-layout">
    <aside class="left-panel" :style="{ width: leftWidth + 'px' }">
      <div class="status-bar">
        <button class="sb-back" @click="goBack">← 书架</button>
        <span v-if="title" class="sb-title">{{ title }}</span>
        <span v-if="readingPosition" class="sb-pos-indicator" @click="jumpToReadingPos">
          📍 第 {{ readingPosIdx }} 段
        </span>
        <span class="sb-stats">{{ paragraphs.length }} 段</span>
        <button v-if="pdfUrl" class="sb-pdf-btn" @click="showPdf = true">查看原文</button>
        <button class="theme-toggle" style="margin-left:auto" @click="theme.toggle()">{{ theme.dark.value ? '☀' : '🌙' }}</button>
        <div v-if="isProcessing" class="sb-progress">
          <div class="mini-spinner"></div><span>{{ progressMsg }}</span>
        </div>
      </div>

      <div class="panel-scroll">
        <ArticlePanel
          :paragraphs="paragraphs"
          :active-paragraph-id="activeParagraphId"
          :loading="false"
          :title="title"
          :analysis="analysis"
          :marks="marks"
          :reading-position="readingPosition"
          @paragraph-action="handleParagraphAction"
          @quick-translate="handleQuickTranslate"
          @edit-segment="handleEditSegment"
          @create-mark="handleCreateMark"
          @create-note="handleCreateNote"
          @pronounce="handlePronounce"
          @set-position="handleSetPosition"
          @show-mark="handleShowMark"
        />
      </div>
    </aside>

    <div class="panel-divider" @mousedown="startResize"></div>

    <main class="right-panel" :style="{ width: rightWidth + 'px' }">
      <AnalysisPanel
        :content="rightPanelContent"
        :is-typing="isTyping"
        :displayed-content="displayText"
        :chat-messages="currentParagraphChat"
        :chat-loading="chatLoading"
        :chat-typing="chatTyping"
        :typing-chat-content="typingChatContent"
        :is-waiting="isWaiting"
        @send-chat="handleSendChat"
        @finish-typing="finishStreaming()"
      />
    </main>

    <!-- 浮动翻译卡片 -->
    <TranslateCard
      :visible="tc.visible"
      :text="tc.text"
      :loading="tc.loading"
      :position="tc.position"
      @close="tc.visible = false"
    />

    <!-- 标记详情弹窗 -->
    <MarkPopup
      :visible="markPopup.visible"
      :mark="markPopup.mark"
      :loading="markPopup.loading"
      :typing="markPopup.typing"
      :typing-content="markPopup.typingContent"
      :position="markPopup.position"
      @close="markPopup.visible = false"
      @update-note="handleUpdateNote"
      @delete="handleDeleteMark"
      @pronounce="handlePronounce"
    />

    <!-- PDF 查看 -->
    <div v-if="showPdf && pdfUrl" class="pdf-overlay" @click.self="showPdf = false">
      <div class="pdf-viewer">
        <div class="pdf-viewer-header"><span>PDF 原文</span><button class="modal-close" @click="showPdf = false">&times;</button></div>
        <iframe :src="pdfUrl" class="pdf-iframe" frameborder="0"></iframe>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ParagraphAction, ChatMessage, Paragraph, Mark, MarkType, ReadingPosition } from '#shared/types'
import { MARK_COLORS } from '#shared/types'
import { useTheme } from '~/composables/useTheme'
import { useArticle } from '~/composables/useArticle'
import { useDeepSeek } from '~/composables/useDeepSeek'
import { useTextStream } from '~/composables/useTextStream'
const theme = useTheme()

const route = useRoute(); const id = route.params.id as string
useHead({ title: 'AI 阅读分析' })

const article = useArticle(); const deepseek = useDeepSeek(); const textStream = useTextStream()
const chatTextStream = useTextStream()
const { rawText, title, paragraphs, analysis, chatHistory, activeParagraphId, rightPanelContent, isProcessing, currentParagraphChat } = article
const { displayText, isTyping, startStreaming, appendText, endStream, finishStreaming, stopStreaming, showAll } = textStream
const { displayText: tcc, isTyping: chatTyping, startStreaming: startChatStream, appendText: appendChatText, endStream: endChatStream, stopStreaming: stopChatStream } = chatTextStream
const typingChatContent = computed(() => tcc.value)

const chatLoading = ref(false); const progressMsg = ref(''); const isWaiting = ref(false)
const pdfUrl = ref(''); const showPdf = ref(false)
const marks = ref<Mark[]>([]); const readingPosition = ref<ReadingPosition | null>(null)
const leftWidth = ref(600); const rightWidth = ref(600)

// 浮动翻译卡片
const tc = reactive({ visible: false, text: '', loading: false, position: { x: 200, y: 200 } })

// MarkPopup
const markPopup = reactive<{ visible: boolean; mark: Mark; loading: boolean; typing: boolean; typingContent: string; position: { x: number; y: number } }>({
  visible: false, mark: { id: '', paragraphId: '', startOffset: 0, endOffset: 0, text: '', type: 'word', color: '', detail: '', note: '', createdAt: '' },
  loading: false, typing: false, typingContent: '', position: { x: 200, y: 200 }
})

const readingPosIdx = computed(() => {
  if (!readingPosition.value) return 0
  return paragraphs.value.findIndex(p => p.id === readingPosition.value!.paragraphId) + 1
})

let resizing = false
function startResize(e: MouseEvent) {
  resizing = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'
  const onMove = (ev: MouseEvent) => {
    if (!resizing) return; const t = window.innerWidth; let l = ev.clientX; if (l < 320) l = 320; if (l > t - 326) l = t - 326
    leftWidth.value = l; rightWidth.value = t - l - 6
  }
  const onUp = () => { resizing = false; document.body.style.cursor = ''; document.body.style.userSelect = ''
    document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
}

// 加载
onMounted(() => { leftWidth.value = Math.floor(window.innerWidth * 0.5); rightWidth.value = Math.floor(window.innerWidth * 0.5 - 6) })
onMounted(async () => {
  try {
    const data = await $fetch<any>(`/api/text/${id}`)
    if (!data?.text) throw new Error('No text')
    article.setRawText(data.text)
    article.setParagraphs(quickSegment(data.text))
    if (data.filePath) pdfUrl.value = `/api/file/${data.filePath}`
    if (data.segments) article.setParagraphs(data.segments)
    if (data.analysis) { article.setAnalysis(data.analysis); showAll(formatMd(data.analysis)) }
    if (data.explanations) for (const [k, v] of Object.entries(data.explanations)) { const [pid, act] = k.split(':'); article.setCachedExplanation(pid, act as any, v as string) }
    if (data.marks) marks.value = data.marks
    if (data.readingPosition) readingPosition.value = data.readingPosition
    if (!data.analysis || !data.segments) await runAnalysis(data.text)

    // 从复习本跳转 → 滚动到标记所在段落
    const markPid = route.query.mark as string
    if (markPid) {
      await nextTick()
      const el = document.querySelector(`[data-id="${markPid}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    // 记录阅读统计
    $fetch('/api/text/stats', { method: 'POST', body: { id, marks: marks.value.length } }).catch(() => {})
  } catch (e: any) { alert('加载失败'); navigateTo('/') }
})

function goBack() { stopStreaming(); article.reset(); navigateTo('/') }

function quickSegment(text: string): Paragraph[] {
  const blocks = text.split(/\n\s*\n/).filter(b => b.trim())
  if (blocks.length <= 1) {
    const prepped = text.replace(/\.{3,}/g, '…'); const sentences = prepped.split(/(?<=[.!?。！？"」])\s*/).map(s => s.replace(/…/g, '...')).filter(s => s.trim().length > 0)
    if (sentences.length > 1) { const ts = Math.max(2, Math.round(sentences.length / Math.round(sentences.length / 2.5))); const g: string[] = []
      for (let i = 0; i < sentences.length; i += ts) { const grp = sentences.slice(i, i + ts); if (grp.length === 1 && g.length > 0) g[g.length - 1] += ' ' + grp[0]; else g.push(grp.join('')) }
      return g.map((t, i) => ({ id: `q-${i}`, index: i, text: t.trim() })) }
    return [{ id: 'q-0', index: 0, text }]
  }
  return blocks.map((t, i) => ({ id: `q-${i}`, index: i, text: t.trim() }))
}

function formatMd(a: any) { return [`## ${a.title}`, '', `**风格**：${a.tone}`, '', '### 内容摘要', a.summary, '', '### 背景分析', a.background, '', '### 关键要点', ...(a.keyPoints||[]).map((k: string) => `- ${k}`)].join('\n') }

async function runAnalysis(text: string) {
  article.isProcessingWritable.value = true; progressMsg.value = ''
  const sentences = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?。！？"」])\s*/).filter((s: string) => s.trim())
  const maxInput = 15000
  const inputText = text.length > maxInput ? text.slice(0, maxInput) + `\n[全文共${text.length}字]` : text
  const prompt = `分析以下文章，输出分析摘要和分段断点。\n\n## 文章\n${inputText}\n\n## 句子索引\n${sentences.map((s: string, i: number) => `[${i}] ${s.slice(0,80)}`).join('\n')}\n\n## 格式\n### 标题\n### 风格\n### 内容摘要\n### 背景分析\n### 关键要点\n- 要点\n### 分段断点\n索引（逗号分隔）:`
  const msgs = [{ role: 'system' as const, content: '按格式输出，禁止开场白。直接从###开始。' }, { role: 'user' as const, content: prompt }]
  let full = ''; startStreaming('')
  try {
    await deepseek.streamExplain(msgs, (chunk: string) => { full += chunk; appendText(chunk) })
    endStream()
    const a = { title: (full.match(/### 标题\n(.+)/)?.[1]||'').trim(), tone: (full.match(/### 风格\n(.+)/)?.[1]||'').trim(), summary: (full.match(/### 内容摘要\n([\s\S]+?)(?=\n###|$)/)?.[1]||'').trim(), background: (full.match(/### 背景分析\n([\s\S]+?)(?=\n###|$)/)?.[1]||'').trim(), keyPoints: (full.match(/### 关键要点\n([\s\S]+?)(?=\n###|$)/)?.[1]||'').split('\n').filter((s: string) => s.trim().startsWith('-')).map((s: string) => s.replace(/^-\s*/, '')) }
    article.setAnalysis(a)
    const bm = full.match(/### 分段断点[^\d]*([\d,\s]+)/); const breaks = (bm?.[1]||'').split(/[,\s]+/).map(Number).filter((n: number) => !isNaN(n))
    const bset = new Set(breaks); const segs: any[] = []; let start = 0
    for (let i = 0; i < sentences.length; i++) { if (bset.has(i) || i === sentences.length - 1) { const t = sentences.slice(start, i + 1).join('').trim(); if (t) segs.push({ id: `p-${segs.length}`, index: segs.length, text: t }); start = i + 1 } }
    if (segs.length <= 1) segs[0] = { id: 'p-0', index: 0, text: sentences.join('') }
    article.setParagraphs(segs)
    $fetch('/api/text/update', { method: 'POST', body: { id, analysis: a, segments: segs } }).catch(() => {})
  } catch { stopStreaming() }
  finally { article.isProcessingWritable.value = false; progressMsg.value = '' }
}

async function handleQuickTranslate(text: string, position: { x: number; y: number }) {
  tc.visible = true; tc.loading = true; tc.text = ''
  tc.position = { x: Math.min(position.x, window.innerWidth - 340), y: position.y + 10 }
  try {
    const result = await deepseek.paragraphAction(text, 'translate', article.getArticleContext())
    tc.text = result; tc.loading = false
  } catch { tc.visible = false }
}

const pendingExplain = ref('')

async function handleParagraphAction(action: ParagraphAction, pid: string, ptext: string) {
  article.setActiveParagraph(pid)
  const cached = article.getCachedExplanation(pid, action)
  if (cached) { article.setRightContent(cached, action); showAll(cached); return }
  if (pendingExplain.value === pid) return
  pendingExplain.value = pid
  isWaiting.value = false
  article.setRightContent('', action)

  // 构建 prompt（复用 explain/translate 逻辑）
  const typeLabel = action === 'translate' ? '专业翻译' : '双语阅读导师'
  const requirements = action === 'translate'
    ? `将以下段落翻译成流畅自然的中文。忠实原文，只输出翻译结果，不要添加任何解释。\n\n待翻译段落：\n${ptext}`
    : `深度解读以下段落，结合文章背景。用 Markdown 输出三部分：### 一、整体翻译 ### 二、难点词汇解析（表格） ### 三、段落精讲。\n\n文章背景：${article.getArticleContext()}\n\n段落：${ptext}`

  const messages = [
    { role: 'system' as const, content: `你是一位${typeLabel}。禁止开场白和自我介绍。` },
    { role: 'user' as const, content: requirements }
  ]

  // 流式接收
  let fullResult = ''
  startStreaming('')
  try {
    await deepseek.streamExplain(messages, (chunk: string) => {
      fullResult += chunk
      appendText(chunk)
    })
    endStream()
    // 缓存和持久化
    article.setCachedExplanation(pid, action, fullResult)
    article.setRightContent(fullResult, action)
    $fetch('/api/text/update', { method: 'POST', body: { id, explanations: { [`${pid}:${action}`]: fullResult } } }).catch(() => {})
  } catch (e: any) { stopStreaming() }
  finally { pendingExplain.value = '' }
}

async function handleEditSegment(pid: string, newText: string) {
  const newSegs = paragraphs.value.map((p: any) => p.id === pid ? { ...p, text: newText } : p)
  article.setParagraphs(newSegs)
  await $fetch('/api/text/update-segment', { method: 'POST', body: { textId: id, segmentId: pid, text: newText } }).catch(() => {})
}

// 标记
function handleCreateNote(pid: string, text: string, startOffset: number, endOffset: number) {
  const m: Mark = { id: `n_${Date.now()}`, paragraphId: pid, startOffset, endOffset, text, type: 'note' as any, color: '#fbcfe8', detail: '', note: '', createdAt: new Date().toISOString() }
  marks.value.push(m)
}

async function handleCreateMark(pid: string, text: string, type: MarkType, startOffset: number, endOffset: number) {
  const dup = marks.value.find(m => m.paragraphId === pid && m.startOffset === startOffset && m.endOffset === endOffset)
  if (dup) return

  const m: Mark = { id: `m_${Date.now()}`, paragraphId: pid, startOffset, endOffset, text, type, color: MARK_COLORS[type], detail: '', note: '', createdAt: new Date().toISOString() }
  marks.value.push(m); saveMarks()

  markPopup.mark = m; markPopup.visible = true; markPopup.loading = true; markPopup.typing = true; markPopup.typingContent = ''
  markPopup.position = { x: Math.min(window.innerWidth - 420, 400), y: 120 }

  // 构建结构化 prompt（复用 mark.post.ts 的详细要求）
  const para = paragraphs.value.find(p => p.id === pid)
  const requirements = type === 'word'
    ? `### 基本释义\n列出该词的核心含义（1~2个）。\n\n### 其他常用用法\n列出该词在不同语境下的常见用法（简短说明+例句）。\n\n### 当前语境用法\n分析该词在当前段落中的具体含义和语用功能。\n\n输出结尾单独一行：[PHONETIC]/音标/[/PHONETIC]`
    : type === 'phrase'
    ? `### 短语含义\n解释该短语/搭配的意思。\n\n### 用法说明\n说明该短语的语法结构、语域和使用场景。\n\n### 语境分析\n分析该短语在当前段落中的作用和表达效果。\n\n### 可替换表达\n提供 1~2 个近义表达。`
    : `### 句子解析\n分析句子语法结构和逻辑关系。\n\n### 含义阐述\n用中文解释句子含义。\n\n### 修辞/表达分析\n分析句子中的修辞手法或表达技巧。\n\n### 在段落中的作用\n说明该句在段落中的功能。`

  const msgs = [
    { role: 'system' as const, content: '你是专业的双语阅读导师。禁止开场白、自我介绍、重复待解释内容。直接从第一个 ### 标题开始输出。' },
    { role: 'user' as const, content: `文章背景：${article.getArticleContext()}\n\n所在段落：${para?.text || ''}\n\n待解释：${text}\n\n## 要求\n${requirements}` }
  ]

  let full = ''
  try {
    await deepseek.streamExplain(msgs, (chunk: string) => {
      full += chunk; markPopup.typingContent = full
    })
    m.detail = full; markPopup.typing = false; markPopup.loading = false
  } catch { markPopup.typing = false; markPopup.loading = false }
  saveMarks()
}

function handleShowMark(mark: Mark) {
  markPopup.mark = mark; markPopup.visible = true; markPopup.loading = false; markPopup.position = { x: Math.min(window.innerWidth - 420, 400), y: 120 }
}

async function handleUpdateNote(note: string) {
  markPopup.mark.note = note
  const idx = marks.value.findIndex(m => m.id === markPopup.mark.id)
  if (idx !== -1) { marks.value[idx].note = note; saveMarks() }
}

function handleDeleteMark() {
  marks.value = marks.value.filter(m => m.id !== markPopup.mark.id)
  markPopup.visible = false
  saveMarks()
}

async function saveMarks() {
  $fetch('/api/text/update', { method: 'POST', body: { id, marks: marks.value } }).catch(() => {})
}

// 阅读位置
function handleSetPosition(pid: string) {
  readingPosition.value = { paragraphId: pid, updatedAt: new Date().toISOString() }
  $fetch('/api/text/update', { method: 'POST', body: { id, readingPosition: readingPosition.value } }).catch(() => {})
}

function jumpToReadingPos() {
  if (!readingPosition.value) return
  const el = document.querySelector(`[data-id="${readingPosition.value.paragraphId}"]`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function handlePronounce(word: string) { article.pronounceWord(word) }

async function handleSendChat(message: string) {
  if (!message.trim() || chatLoading.value) return; const pid = activeParagraphId.value; if (!pid) return
  const para = paragraphs.value.find(p => p.id === pid)
  const ctx = [para ? `段落原文：\n${para.text}` : '', rightPanelContent.value ? `分析内容：\n${rightPanelContent.value}` : ''].filter(Boolean).join('\n\n')
  const um: ChatMessage = { role: 'user', content: message }; article.addParagraphChatMessage(pid, um); chatLoading.value = true

  const systemMsg = { role: 'system' as const, content: `你是专注的阅读导师。结合文章背景和当前段落回答用户问题。\n\n文章背景：${article.getArticleContext()}\n\n当前段落上下文：${ctx}` }
  const messages = [systemMsg, ...article.getParagraphChat(pid)]

  let fullReply = ''
  startChatStream('')
  try {
    await deepseek.streamExplain(messages, (chunk: string) => {
      fullReply += chunk
      appendChatText(chunk)
    })
    endChatStream()
    const am: ChatMessage = { role: 'assistant', content: fullReply }; article.addParagraphChatMessage(pid, am)
  } catch (e: any) { stopChatStream() }
  finally { chatLoading.value = false }
}

function handlePopupPronounce(word: string) { article.pronounceWord(word) }
</script>
