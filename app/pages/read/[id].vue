<template>
  <div class="reader-app">
    <!-- 顶部栏 -->
    <header class="reader-topbar">
      <button class="back-btn" @click="goBack">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        书架
      </button>

      <div class="reader-title-center">
        <span class="reader-doc-title">{{ title || '加载中…' }}</span>
      </div>

      <div class="reader-topbar-right">
        <div v-if="paragraphs.length" class="progress-wrap">
          <div class="progress-dots">
            <span
              v-for="(p, i) in paragraphs"
              :key="p.id"
              class="progress-dot"
              :class="{ done: i < currentParaIdx, current: p.id === activeParagraphId }"
            />
          </div>
          <span class="progress-text">第 {{ currentParaIdx + 1 }} 段 · 共 {{ paragraphs.length }} 段</span>
        </div>
        <div v-if="isProcessing" class="reader-progress-bar">
          <div class="mini-spinner"></div><span>{{ progressMsg }}</span>
        </div>
        <button v-if="pdfUrl" class="reader-icon-btn" @click="showPdf = true" title="查看 PDF 原文">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
        </button>
        <button v-if="readingPosition" class="reader-icon-btn" @click="jumpToReadingPos" title="跳转到上次阅读位置">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </button>
      </div>
    </header>

    <div class="reader-body" ref="readerBodyEl">
      <!-- 正文区 -->
      <article class="reader-article-pane" ref="articlePane" :style="{ width: leftWidth + 'px' }">
        <div
          v-for="(para, index) in paragraphs"
          :key="para.id"
          :data-id="para.id"
          class="para-block"
          :class="{ active: para.id === activeParagraphId, past: para.id < activeParagraphId }"
          :ref="el => { if (el) paraRefs[index] = el }"
          @click="handleParaClick(para, $event)"
          @mouseup="handleTextSelect(para)"
        >
          <div
            class="para-num"
            :class="{ 'pos-marker': readingPosition?.paragraphId === para.id }"
            @click.stop="handleSetPosition(para.id)"
            :title="readingPosition?.paragraphId === para.id ? '当前阅读位置' : '点击标记阅读位置'"
          >{{ index + 1 }}</div>
          <p class="para-text" v-html="renderMarkedText(para)"></p>
          <div class="para-actions" v-if="para.id === activeParagraphId" @click.stop>
            <button class="para-action-btn" @click.stop="handleParagraphAction('translate', para.id, para.text)" title="翻译">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>
              </svg>
            </button>
            <button class="para-action-btn" @click.stop="startEdit(para.id)" title="编辑">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
              </svg>
            </button>
            <button class="para-action-btn" @click.stop="doCopy(para.text)" title="复制">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
        </div>
      </article>

      <!-- 可拖拽分割线 -->
      <div class="panel-divider" @mousedown="startResize"></div>

      <!-- 右侧面板 -->
      <aside class="reader-panel" :style="{ width: rightWidth + 'px' }">
        <div class="panel-tabs">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="tab-btn"
            :class="{ active: activeTab === tab.key }"
            @click="activeTab = tab.key"
          >{{ tab.label }}</button>
        </div>

        <!-- 理解 Tab -->
        <div v-if="activeTab === 'understand'" class="panel-content">
          <div class="panel-scroll">
            <section class="panel-section" v-if="rightPanelContent || isTyping || displayedContent">
              <div class="section-header">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                段落解析
              </div>
              <div class="section-text">
                <MarkdownRenderer v-if="displayedContent || rightPanelContent" :content="displayedContent || rightPanelContent"/>
                <span v-if="isTyping" class="typing-cursor">|</span>
              </div>
            </section>

            <div v-if="!rightPanelContent && !isTyping && !displayedContent" class="empty-state">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <p>点击段落查看 AI 解析</p>
            </div>
          </div>

          <!-- 聊天区 -->
          <div class="chat-area">
            <div class="chat-messages" ref="chatMessagesEl">
              <div
                v-for="(msg, i) in currentParagraphChat"
                :key="i"
                class="chat-msg"
                :class="msg.role"
              >
                <div class="chat-bubble">{{ msg.content }}</div>
              </div>
              <div v-if="chatLoading && !chatTyping" class="chat-msg ai">
                <div class="chat-bubble" style="color:#a09e97">思考中…</div>
              </div>
            </div>
            <div class="chat-input-row">
              <input
                class="chat-input"
                v-model="chatInput"
                placeholder="提问关于当前段落的问题…"
                @keydown.enter="sendChat"
                :disabled="chatLoading"
              />
              <button class="send-btn" @click="sendChat" :disabled="!chatInput.trim() || chatLoading">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- 笔记 Tab -->
        <div v-if="activeTab === 'notes'" class="panel-content">
          <div class="panel-scroll">
            <div v-if="notes.length === 0" class="empty-state">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
              <p>选中文字后点「记」可添加笔记</p>
            </div>
            <div v-for="note in notes" :key="note.id" class="note-card">
              <div class="note-para">第 {{ note.paraIdx }} 段</div>
              <p class="note-content">{{ note.content }}</p>
            </div>
          </div>
        </div>

        <!-- 生词 Tab -->
        <div v-if="activeTab === 'vocab'" class="panel-content">
          <div class="panel-scroll">
            <div v-if="savedVocab.length === 0" class="empty-state">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              </svg>
              <p>标记的生词会显示在这里</p>
            </div>
            <div v-for="word in savedVocab" :key="word.word" class="vocab-card">
              <div class="vocab-word">{{ word.text }}</div>
              <div class="vocab-phonetic">{{ word.phonetic }}</div>
              <div class="vocab-meaning">{{ word.meaning }}</div>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <!-- 选中文字工具条 -->
    <Teleport to="body">
      <div v-if="selToolbar.visible" class="sel-toolbar" :style="selToolbarStyle">
        <button class="sel-btn" style="--c:#f59e0b" @click="createMark('word')" title="标记为生词">
          <span class="sel-label">词</span><span class="sel-hint">标记</span>
        </button>
        <button class="sel-btn" style="--c:#10b981" @click="createMark('phrase')" title="标记为短语">
          <span class="sel-label">短</span><span class="sel-hint">标记</span>
        </button>
        <button class="sel-btn" style="--c:#06b6d4" @click="createMark('sentence')" title="标记为句子">
          <span class="sel-label">句</span><span class="sel-hint">标记</span>
        </button>
        <button class="sel-btn" style="--c:#ec4899" @click="handleCreateNote(selToolbar.paraId, selToolbar.text, selToolbar.startOffset, selToolbar.endOffset); selToolbar.visible = false; window.getSelection()?.removeAllRanges()" title="添加笔记">
          <span class="sel-label">记</span><span class="sel-hint">笔记</span>
        </button>
        <button class="sel-btn" style="--c:#8b5cf6" @click="handleQuickTranslate(selToolbar.text, { x: selToolbar.x, y: selToolbar.y }); selToolbar.visible = false; window.getSelection()?.removeAllRanges()" title="翻译选中">
          <span class="sel-label">译</span><span class="sel-hint">翻译</span>
        </button>
      </div>
    </Teleport>

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
import { useArticle } from '~/composables/useArticle'
import { useDeepSeek } from '~/composables/useDeepSeek'
import { useTextStream } from '~/composables/useTextStream'
import MarkdownRenderer from '~/components/MarkdownRenderer.vue'

const route = useRoute(); const id = route.params.id as string
useHead({ title: 'AI 阅读分析' })

const article = useArticle(); const deepseek = useDeepSeek(); const textStream = useTextStream()
const chatTextStream = useTextStream()
const { rawText, title, paragraphs, analysis, chatHistory, activeParagraphId, rightPanelContent, isProcessing, currentParagraphChat } = article
const { displayText: displayedContent, isTyping, startStreaming, appendText, endStream, finishStreaming, stopStreaming, showAll } = textStream
const { displayText: tcc, isTyping: chatTyping, startStreaming: startChatStream, appendText: appendChatText, endStream: endChatStream, stopStreaming: stopChatStream } = chatTextStream
const typingChatContent = computed(() => tcc.value)

const activeTab = ref('understand')
const chatInput = ref('')
const chatLoading = ref(false)
const progressMsg = ref('')
const pdfUrl = ref(''); const showPdf = ref(false)
const marks = ref<Mark[]>([]); const readingPosition = ref<ReadingPosition | null>(null)
const readerBodyEl = ref<HTMLElement | null>(null)
const articlePane = ref<HTMLElement | null>(null)
const chatMessagesEl = ref<HTMLElement | null>(null)
const paraRefs = ref<HTMLElement[]>([])
const leftWidth = ref(0)
const rightWidth = ref(340)

// 笔记/生词本地数据
const notes = ref<Array<{ id: string; paraIdx: number; content: string; createdAt: string }>>([])
const savedVocab = ref<Array<{ text: string; phonetic: string; meaning: string }>>([])

const tabs = [
  { key: 'understand', label: '理解' },
  { key: 'notes', label: '笔记' },
  { key: 'vocab', label: '生词' },
]

const currentParaIdx = computed(() => {
  if (!activeParagraphId.value) return 0
  return paragraphs.value.findIndex(p => p.id === activeParagraphId.value)
})

const readingPosIdx = computed(() => {
  if (!readingPosition.value) return 0
  return paragraphs.value.findIndex(p => p.id === readingPosition.value!.paragraphId) + 1
})

// 浮动翻译卡片
const tc = reactive({ visible: false, text: '', loading: false, position: { x: 200, y: 200 } })

// MarkPopup
const markPopup = reactive<{ visible: boolean; mark: Mark; loading: boolean; typing: boolean; typingContent: string; position: { x: number; y: number } }>({
  visible: false, mark: { id: '', paragraphId: '', startOffset: 0, endOffset: 0, text: '', type: 'word', color: '', detail: '', note: '', createdAt: '' },
  loading: false, typing: false, typingContent: '', position: { x: 200, y: 200 }
})

// ---- 渲染标记文字 ----
function renderMarkedText(p: Paragraph): string {
  let html = escapeHtml(p.text)
  const all = marks.value.filter(m => m.paragraphId === p.id)
    .sort((a, b) => b.startOffset - a.startOffset)
  const covered: Array<{ s: number; e: number }> = []
  for (const m of all) {
    const overlaps = covered.some(c => m.startOffset < c.e && m.endOffset > c.s)
    if (overlaps) continue
    const before = html.slice(0, m.startOffset)
    const marked = html.slice(m.startOffset, m.endOffset)
    const after = html.slice(m.endOffset)
    html = `${before}<mark class="hl-${m.type}" data-mark-id="${m.id}" style="background:${m.color}22;border-bottom:2px solid ${m.color};cursor:pointer;border-radius:2px;padding:1px 0">${marked}</mark>${after}`
    covered.push({ s: m.startOffset, e: m.endOffset })
  }
  return html
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---- 面板拖拽调整 ----
let resizing = false
function startResize(e: MouseEvent) {
  resizing = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'
  const onMove = (ev: MouseEvent) => {
    if (!resizing) return; const t = window.innerWidth
    let l = ev.clientX; if (l < 320) l = 320; if (l > t - 340) l = t - 340
    leftWidth.value = l; rightWidth.value = t - l - 6
  }
  const onUp = () => { resizing = false; document.body.style.cursor = ''; document.body.style.userSelect = ''
    document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
}

// ---- 文本选择工具条（与旧版 ArticlePanel 完全一致的 mouseup 方式） ----
const selToolbar = reactive({ visible: false, x: 0, y: 0, text: '', paraId: '', startOffset: 0, endOffset: 0 })
const selToolbarStyle = computed(() => {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1024
  return {
    left: Math.max(150, Math.min(selToolbar.x, w - 170)) + 'px',
    top: Math.max(8, selToolbar.y - 50) + 'px',
  }
})

function handleTextSelect(p: Paragraph) {
  setTimeout(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      selToolbar.visible = false
      return
    }
    const text = sel.toString().trim()
    if (text.length < 2 || text.length > 300) { selToolbar.visible = false; return }
    const range = sel.getRangeAt(0)
    const paraEl = (sel.anchorNode?.parentElement)?.closest('.para-text')
    if (!paraEl) { selToolbar.visible = false; return }
    const startOffset = getTextOffset(paraEl, range.startContainer, range.startOffset)
    const endOffset = getTextOffset(paraEl, range.endContainer, range.endOffset)
    if (startOffset < 0 || endOffset < 0) return
    const rect = range.getBoundingClientRect()
    selToolbar.visible = true
    selToolbar.x = rect.left + rect.width / 2
    selToolbar.y = rect.top
    selToolbar.text = text
    selToolbar.paraId = p.id
    selToolbar.startOffset = startOffset
    selToolbar.endOffset = endOffset
  }, 10)
}

function getTextOffset(root: Element, targetNode: Node, nodeOffset: number): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let offset = 0; let node: Node | null
  while ((node = walker.nextNode())) {
    if (node === targetNode) return offset + nodeOffset
    offset += (node.textContent || '').length
  }
  return -1
}

function createMark(type: MarkType) {
  handleCreateMark(selToolbar.paraId, selToolbar.text, type, selToolbar.startOffset, selToolbar.endOffset)
  selToolbar.visible = false
  window.getSelection()?.removeAllRanges()
}

// ---- 段落点击 ----
let clickTimer: ReturnType<typeof setTimeout> | null = null
let pendingPara: Paragraph | null = null

function handleParaClick(p: Paragraph, e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.tagName === 'MARK') {
    const mid = target.dataset.markId
    const mark = marks.value.find(m => m.id === mid)
    if (mark && mark.type !== 'note') { handleShowMark(mark); return }
  }
  if (clickTimer) clearTimeout(clickTimer)
  const sel = window.getSelection()
  if (sel && !sel.isCollapsed) return
  article.setActiveParagraph(p.id)
  pendingPara = p
  clickTimer = setTimeout(() => {
    if (pendingPara) {
      handleParagraphAction('explain', pendingPara.id, pendingPara.text)
      pendingPara = null
    }
  }, 300)
}

function doCopy(text: string) { navigator.clipboard.writeText(text).catch(() => {}) }
function startEdit(pid: string) {} // placeholder — 保留给未来编辑功能

// ---- 加载 ----
onMounted(() => {
  leftWidth.value = Math.floor(window.innerWidth * 0.6)
  rightWidth.value = Math.floor(window.innerWidth * 0.4 - 6)
})
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
    const markPid = route.query.mark as string
    if (markPid) { await nextTick(); const el = document.querySelector(`[data-id="${markPid}"]`); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
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

const pendingExplain = ref('')
async function handleParagraphAction(action: ParagraphAction, pid: string, ptext: string) {
  article.setActiveParagraph(pid)
  const cached = article.getCachedExplanation(pid, action)
  if (cached) { article.setRightContent(cached, action); showAll(cached); return }
  if (pendingExplain.value === pid) return
  pendingExplain.value = pid
  article.setRightContent('', action)
  const typeLabel = action === 'translate' ? '专业翻译' : '双语阅读导师'
  const requirements = action === 'translate'
    ? `将以下段落翻译成流畅自然的中文。忠实原文，只输出翻译结果，不要添加任何解释。\n\n待翻译段落：\n${ptext}`
    : `深度解读以下段落，结合文章背景。用 Markdown 输出三部分：### 一、整体翻译 ### 二、难点词汇解析（表格） ### 三、段落精讲。\n\n文章背景：${article.getArticleContext()}\n\n段落：${ptext}`
  const messages = [
    { role: 'system' as const, content: `你是一位${typeLabel}。禁止开场白和自我介绍。` },
    { role: 'user' as const, content: requirements }
  ]
  let fullResult = ''; startStreaming('')
  try {
    await deepseek.streamExplain(messages, (chunk: string) => { fullResult += chunk; appendText(chunk) })
    endStream()
    article.setCachedExplanation(pid, action, fullResult)
    article.setRightContent(fullResult, action)
    $fetch('/api/text/update', { method: 'POST', body: { id, explanations: { [`${pid}:${action}`]: fullResult } } }).catch(() => {})
  } catch (e: any) { stopStreaming() }
  finally { pendingExplain.value = '' }
}

async function handleQuickTranslate(text: string, position: { x: number; y: number }) {
  tc.visible = true; tc.loading = true; tc.text = ''
  tc.position = { x: Math.min(position.x, window.innerWidth - 340), y: position.y + 10 }
  try {
    const result = await deepseek.paragraphAction(text, 'translate', article.getArticleContext())
    tc.text = result; tc.loading = false
  } catch { tc.visible = false }
}

// 标记
function handleCreateNote(pid: string, text: string, startOffset: number, endOffset: number) {
  const idx = paragraphs.value.findIndex(p => p.id === pid)
  notes.value.push({ id: `n_${Date.now()}`, paraIdx: idx + 1, content: text, createdAt: new Date().toISOString() })
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
    await deepseek.streamExplain(msgs, (chunk: string) => { full += chunk; markPopup.typingContent = full })
    m.detail = full; markPopup.typing = false; markPopup.loading = false
    // 生词自动收藏
    if (type === 'word') {
      const phoneticMatch = full.match(/\[PHONETIC\]\/(.+?)\/\[\/PHONETIC\]/)
      const meaningMatch = full.match(/### 基本释义\n(.+)/)
      savedVocab.value.push({ text, phonetic: phoneticMatch?.[1] || '', meaning: meaningMatch?.[1]?.trim() || '' })
    }
  } catch { markPopup.typing = false; markPopup.loading = false }
  saveMarks()
}

function handleShowMark(mark: Mark) {
  markPopup.mark = mark; markPopup.visible = true; markPopup.loading = false
  markPopup.position = { x: Math.min(window.innerWidth - 420, 400), y: 120 }
}

async function handleUpdateNote(note: string) {
  markPopup.mark.note = note
  const idx = marks.value.findIndex(m => m.id === markPopup.mark.id)
  if (idx !== -1) { marks.value[idx].note = note; saveMarks() }
}

function handleDeleteMark() {
  marks.value = marks.value.filter(m => m.id !== markPopup.mark.id)
  markPopup.visible = false; saveMarks()
}

async function saveMarks() {
  $fetch('/api/text/update', { method: 'POST', body: { id, marks: marks.value } }).catch(() => {})
}

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

async function sendChat() {
  const msg = chatInput.value.trim(); if (!msg || chatLoading.value) return
  const pid = activeParagraphId.value; if (!pid) return
  const para = paragraphs.value.find(p => p.id === pid)
  const ctx = [para ? `段落原文：\n${para.text}` : '', rightPanelContent.value ? `分析内容：\n${rightPanelContent.value}` : ''].filter(Boolean).join('\n\n')
  const um: ChatMessage = { role: 'user', content: msg }; article.addParagraphChatMessage(pid, um); chatLoading.value = true; chatInput.value = ''
  const systemMsg = { role: 'system' as const, content: `你是专注的阅读导师。结合文章背景和当前段落回答用户问题。\n\n文章背景：${article.getArticleContext()}\n\n当前段落上下文：${ctx}` }
  const messages = [systemMsg, ...article.getParagraphChat(pid)]
  let fullReply = ''; startChatStream('')
  try {
    await deepseek.streamExplain(messages, (chunk: string) => { fullReply += chunk; appendChatText(chunk) })
    endChatStream()
    const am: ChatMessage = { role: 'assistant', content: fullReply }; article.addParagraphChatMessage(pid, am)
  } catch (e: any) { stopChatStream() }
  finally { chatLoading.value = false; nextTick(() => { if (chatMessagesEl.value) chatMessagesEl.value.scrollTop = chatMessagesEl.value.scrollHeight }) }
}

onUnmounted(() => { if (clickTimer) clearTimeout(clickTimer); if (selPlayTimer) clearTimeout(selPlayTimer) })
</script>

<style scoped>
.reader-app { display: flex; flex-direction: column; height: 100vh; font-family: 'DM Sans', sans-serif; background: #ffffff; color: #1a1a18; }

/* 选中文字浮动工具条 */
.sel-toolbar {
  position: fixed; z-index: 1500; display: flex; gap: 6px;
  background: #ffffff; border: 0.5px solid rgba(0,0,0,0.1); border-radius: 12px;
  padding: 8px 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.1); transform: translate(-50%, 0);
}
.sel-btn { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 42px; padding: 5px 7px; border: 1.5px solid transparent; border-radius: 9px; background: #f8fafc; cursor: pointer; transition: all 0.12s; }
.sel-label { font-size: 14px; font-weight: 700; color: var(--c); }
.sel-hint { font-size: 10px; color: #a09e97; line-height: 1; }
.sel-btn:hover { background: #ffffff; border-color: var(--c); }

/* 标记高亮 */
:deep(mark) { cursor: pointer; transition: filter 0.12s; }
:deep(mark:hover) { filter: brightness(0.92); }

/* 阅读位置标记 */
.para-num.pos-marker {
  background: #3d3591 !important;
  color: #ffffff !important;
  box-shadow: 0 0 0 4px rgba(61,53,145,0.2);
  animation: pulsePos 2s infinite;
}
@keyframes pulsePos { 0%,100%{box-shadow:0 0 0 4px rgba(61,53,145,0.2)} 50%{box-shadow:0 0 0 10px rgba(61,53,145,0)}}

/* typing cursor */
.typing-cursor { display: inline; color: #3d3591; animation: blink 0.8s infinite; font-weight: 100; }
@keyframes blink { 0%,50%{opacity:1} 51%,100%{opacity:0} }
</style>
