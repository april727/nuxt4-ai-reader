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
            <template v-for="item in visibleDots" :key="item.key">
              <span v-if="item.type === 'dot'" class="progress-dot" :class="{ done: item.index < currentParaIdx, current: paragraphs[item.index]?.id === activeParagraphId }" />
              <span v-else class="progress-gap">…</span>
            </template>
          </div>
          <span class="progress-text">第 {{ currentParaIdx + 1 }} 段 · 共 {{ paragraphs.length }} 段</span>
        </div>
        <div v-if="isProcessing || progressMsg" class="reader-progress-bar" :class="{ error: progressError }">
          <div v-if="isProcessing" class="mini-spinner"></div>
          <svg v-else-if="progressError" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="16 10 11 15 8 12"/></svg>
          <span>{{ progressMsg }}</span>
          <button v-if="progressError" class="progress-dismiss" @click="dismissProgress">×</button>
        </div>
        <button v-if="isVideo" class="reader-icon-btn" @click="goToWatch" title="回到播放模式">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
          </svg>
        </button>
        <button v-if="pdfUrl" class="reader-icon-btn" @click="pdfPage = null; showPdf = true" title="查看 PDF 原文">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
        </button>
        <button v-if="readingPosition" class="reader-icon-btn" @click="jumpToReadingPos" title="跳转到上次阅读位置">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </button>
        <button class="reader-icon-btn" @click="toggleSearch" title="搜索 (Ctrl+F)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
        </button>
        <button class="reader-icon-btn" @click="runManualAnalysis" title="AI 智能分析" :disabled="analyzing">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/>
            <path d="M8 12a4 4 0 1 1 8 0"/>
            <circle cx="12" cy="12" r="2.5"/>
            <line x1="12" y1="2" x2="12" y2="5"/>
            <line x1="12" y1="19" x2="12" y2="22"/>
          </svg>
        </button>
      </div>
    </header>

    <!-- 书内搜索条 -->
    <div v-if="searchVisible" class="search-bar">
      <div class="search-bar-inner">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="search-bar-icon">
          <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
        </svg>
        <input
          ref="searchInputRef"
          v-model="searchText"
          class="search-bar-input"
          placeholder="搜索文章内容…"
          @input="doSearch"
          @keydown.enter="nextMatch"
          @keydown.escape="searchVisible = false"
        />
        <span v-if="searchText" class="search-bar-count">{{ searchMatches?.length ? `${currentMatchIdx + 1}/${searchMatches.length}` : '0' }}</span>
        <button v-if="searchText" class="search-bar-nav" @click="prevMatch" :disabled="!searchMatches?.length">▲</button>
        <button v-if="searchText" class="search-bar-nav" @click="nextMatch" :disabled="!searchMatches?.length">▼</button>
        <button class="search-bar-close" @click="searchVisible = false">×</button>
      </div>
    </div>

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
          @dblclick="handleDoubleClick(para)"
        >
          <div
            class="para-num"
            :class="{ 'pos-marker': readingPosition?.paragraphId === para.id, 'has-chat': paragraphsWithChats.has(para.id), 'is-video': isVideo }"
            @click.stop="handleSetPosition(para.id)"
            :title="readingPosition?.paragraphId === para.id ? '当前阅读位置' : '点击标记阅读位置'"
          >
            <template v-if="isVideo && (para as any).start !== undefined">{{ formatCueTime((para as any).start) }}</template>
            <template v-else>{{ index + 1 }}</template>
          </div>
          <p v-if="editingParagraphId !== para.id" class="para-text" v-html="renderMarkedText(para)"></p>
          <textarea
            v-else
            class="para-edit-area"
            v-model="editText"
            @keydown.escape="cancelEdit"
            @keydown.ctrl.enter="saveEdit(para.id)"
            rows="4"
          ></textarea>
          <div class="para-actions" v-if="para.id === activeParagraphId" @click.stop>
            <button
              v-if="isVideo && (para as any).start !== undefined"
              class="para-action-btn"
              @click.stop="playSegment(para)"
              :title="miniPlayerVisible && miniPlayerStart === (para as any).start ? '跳转到播放页' : '播放本段'"
            >
              <!-- 播放中：音频波形动画 -->
              <span v-if="miniPlayerPlaying && miniPlayerStart === (para as any).start" class="playing-bars">
                <span v-for="i in 3" :key="i" class="playing-bar" :style="{ animationDelay: (i * 0.15) + 's' }"></span>
              </span>
              <!-- 暂停 / 未播放：三角 -->
              <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polygon points="5,3 19,12 5,21"/>
              </svg>
            </button>
            <button
              v-if="editingParagraphId === para.id"
              class="para-action-btn edit-confirm"
              @click.stop="saveEdit(para.id)"
              title="确认修改"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </button>
            <button
              v-else
              class="para-action-btn"
              @click.stop="startEdit(para.id)"
              title="编辑"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
              </svg>
            </button>
            <button class="para-action-btn" @click.stop="focusChatInput" title="快捷提问">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                <line x1="9" y1="10" x2="15" y2="10"/>
                <line x1="12" y1="7" x2="12" y2="13"/>
              </svg>
            </button>
            <button class="para-action-btn" @click.stop="doCopy(para.text)" title="复制">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
            <button
              v-if="pdfUrl && !isVideo"
              class="para-action-btn"
              @click.stop="openPdfAtParagraph(para)"
              title="在原文中定位"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
            </button>
            <button class="para-action-btn" @click.stop="cleanParagraph(para.id, para.text)" title="整理内容" :disabled="cleaningPara === para.id">
              <div v-if="cleaningPara === para.id" class="mini-spinner-inline"></div>
              <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/><path d="M17 4l3 3-3 3"/><path d="M21 7H9"/>
              </svg>
            </button>
            <button class="para-action-btn" @click.stop="reAnalyzeParagraph(para.id, para.text)" title="重新分析">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
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
        <div v-if="activeTab === 'understand'" class="panel-content qa-panel" @mousemove="onPanelMouseMove">
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

          <!-- 问答浮动区：默认隐藏，鼠标移至理解框底部时出现 -->
          <Transition name="qa-slide"><div v-if="qaVisible" class="qa-area" ref="qaAreaRef" :style="qaCollapsed ? { background: 'transparent', borderTopColor: 'transparent' } : {}" @mouseenter="stopQaHideTimer" @mouseleave="qaCollapsed && startQaHideTimer()">
            <!-- 拖拽手柄（有回答内容时才显示） -->
            <div v-if="hasAnswerContent" class="qa-resize-handle" @mousedown.prevent="startQaResize"></div>
            <!-- 回答区 -->
            <div class="qa-answer" ref="qaAnswerRef" :style="qaAnswerStyle">
              <div
                v-for="(msg, i) in currentParagraphChat"
                :key="i"
                class="chat-msg"
                :class="msg.role"
              >
                <div class="chat-bubble"><MarkdownRenderer :content="msg.content" /></div>
              </div>
              <!-- 流式输出中 -->
              <div v-if="chatTyping" class="chat-msg ai">
                <div class="chat-bubble"><MarkdownRenderer :content="typingChatContent" /><span class="typing-cursor">|</span></div>
              </div>
              <div v-else-if="chatLoading && !chatTyping" class="chat-msg ai">
                <div class="chat-bubble" style="color:#a09e97">思考中…</div>
              </div>
            </div>
            <!-- 提问输入框 -->
            <div class="qa-input-row">
              <input
                ref="chatInputEl"
                class="chat-input"
                v-model="chatInput"
                placeholder="提问关于当前段落的问题…"
                @keydown.enter="sendChat"
                @focus="stopQaHideTimer"
                :disabled="chatLoading"
              />
              <button class="send-btn" @click="sendChat" :disabled="!chatInput.trim() || chatLoading">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </div>
          </Transition>
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
            <div v-for="word in savedVocab" :key="word.text" class="vocab-card">
              <div class="vocab-word">{{ word.text }}</div>
              <div class="vocab-phonetic">{{ word.phonetic }}</div>
              <div class="vocab-meaning">{{ word.meaning }}</div>
              <button class="vocab-pronounce" @click.stop="article.pronounceWord(word.text)" title="发音">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
                </svg>
              </button>
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
        <iframe :src="pdfViewerUrl" class="pdf-iframe" frameborder="0"></iframe>
      </div>
    </div>

    <!-- 迷你播放条（字幕阅读页底部） -->
    <MiniPlayer
      v-if="videoMeta"
      ref="miniPlayerRef"
      :src="videoMeta.url"
      :file-type="videoMeta.type"
      :visible="miniPlayerVisible"
      :start-time="miniPlayerStart"
      :end-time="miniPlayerEnd"
      @close="miniPlayerVisible = false"
    />

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

const videoSources = ['youtube', 'bilibili', 'video_file', 'audio_file']
const source = ref('')
const isVideo = computed(() => videoSources.includes(source.value))
const originalSubtitles = ref<Array<{ text: string; start: number; end: number }> | null>(null)
const videoMeta = ref<{ url: string; type: string; duration: number } | null>(null)
const miniPlayerVisible = ref(false)
const miniPlayerStart = ref(0)
const miniPlayerEnd = ref<number | undefined>(undefined)
const miniPlayerRef = ref<any>(null)
const miniPlayerPlaying = computed(() => miniPlayerRef.value?.playing ?? false)

function playSegment(para: any) {
  if (!videoMeta.value) return
  miniPlayerEnd.value = para.end
  if (miniPlayerVisible.value && miniPlayerStart.value === para.start && isVideo.value) {
    // 同一个段落：切回跳转模式
    jumpToWatch(para)
    return
  }
  miniPlayerStart.value = para.start
  miniPlayerVisible.value = true
}
const { displayText: displayedContent, isTyping, startStreaming, appendText, endStream, finishStreaming, stopStreaming, showAll } = textStream
const { displayText: tcc, isTyping: chatTyping, startStreaming: startChatStream, appendText: appendChatText, endStream: endChatStream, stopStreaming: stopChatStream } = chatTextStream
const typingChatContent = computed(() => tcc.value)

const activeTab = ref('understand')
const chatInput = ref('')
const chatLoading = ref(false)
const progressMsg = ref('')
const pdfUrl = ref(''); const showPdf = ref(false); const pdfPage = ref<number | null>(null)
const pdfViewerUrl = computed(() => {
  if (!pdfUrl.value) return ''
  if (pdfPage.value) return `${pdfUrl.value}#page=${pdfPage.value}`
  return pdfUrl.value
})
const marks = ref<Mark[]>([]); const readingPosition = ref<ReadingPosition | null>(null)
const readerBodyEl = ref<HTMLElement | null>(null)
const articlePane = ref<HTMLElement | null>(null)
const paraRefs = ref<HTMLElement[]>([])
const leftWidth = ref(0)
const rightWidth = ref(340)
// 记录哪些段落有问答历史（用于段落序号指示器）
const paragraphsWithChats = reactive(new Set<string>())

// QA 浮动区状态（按段落独立存储高度和拖拽标记）
const qaVisible = ref(false)
const answerHeightMap = ref<Record<string, number>>({})
const userAdjustedMap = ref<Record<string, boolean>>({})
const answerHeight = computed({
  get: () => answerHeightMap.value[activeParagraphId.value] ?? 120,
  set: (v) => { answerHeightMap.value[activeParagraphId.value] = v }
})
const userAdjustedHeight = computed({
  get: () => userAdjustedMap.value[activeParagraphId.value] ?? false,
  set: (v) => { userAdjustedMap.value[activeParagraphId.value] = v }
})
const QA_MIN_HEIGHT = 0
let qaResizing = false
const qaAnswerRef = ref<HTMLElement | null>(null)
const qaAreaRef = ref<HTMLElement | null>(null)
const chatInputEl = ref<HTMLInputElement | null>(null)
// 是否有回答内容（用于控制回答区是否显示）
const hasAnswerContent = computed(() =>
  currentParagraphChat.value.length > 0 || chatLoading.value || chatTyping.value
)
// QA 是否处于完全折叠态（无内容 + 高度归零）
const qaCollapsed = computed(() => !hasAnswerContent.value && answerHeight.value === 0)
// 回答区样式：折叠态透明，流式输出时自适应高度，手动拖拽后锁定高度
const isStreaming = computed(() => chatTyping.value || chatLoading.value)
const qaAnswerStyle = computed(() => {
  if (!hasAnswerContent.value || answerHeight.value === 0) {
    return { height: '0', padding: '0', overflow: 'hidden' }
  }
  // 流式输出中 → 自适应；用户未手动拖拽过 → 自适应
  if (isStreaming.value || !userAdjustedHeight.value) {
    return {}
  }
  return { height: answerHeight.value + 'px' }
})
// 流式输出期间自动滚到底部
watch(typingChatContent, () => {
  nextTick(() => {
    if (qaAnswerRef.value) qaAnswerRef.value.scrollTop = qaAnswerRef.value.scrollHeight
  })
})
// 折叠态自动隐藏定时器
let qaHideTimer: ReturnType<typeof setTimeout> | null = null
function startQaHideTimer() {
  stopQaHideTimer()
  qaHideTimer = setTimeout(() => { hideQa() }, 1000)
}
function stopQaHideTimer() {
  if (qaHideTimer) { clearTimeout(qaHideTimer); qaHideTimer = null }
}

// 笔记/生词本地数据
// 生词 — 从全文章 marks 中自动提取 type=word 的标记
const savedVocab = computed(() => {
  return marks.value
    .filter(m => m.type === 'word')
    .map(m => {
      const phoneticMatch = m.detail?.match(/\[PHONETIC\]\/(.+?)\/\[\/PHONETIC\]/)
      const meaningMatch = m.detail?.match(/### 基本释义\n(.+)/)
      return {
        text: m.text,
        phonetic: phoneticMatch?.[1] || '',
        meaning: meaningMatch?.[1]?.trim() || '',
      }
    })
})

const tabs = [
  { key: 'understand', label: '理解' },
  { key: 'notes', label: '笔记' },
  { key: 'vocab', label: '生词' },
]

const currentParaIdx = computed(() => {
  if (!activeParagraphId.value) return 0
  return paragraphs.value.findIndex(p => p.id === activeParagraphId.value)
})

/** 超过 80 段时用滑动窗口显示 dots，避免溢出顶栏 */
const MAX_VISIBLE_DOTS = 80
const visibleDots = computed(() => {
  const total = paragraphs.value.length
  if (total <= MAX_VISIBLE_DOTS) {
    return Array.from({ length: total }, (_, i) => ({ type: 'dot' as const, index: i, key: `d${i}` }))
  }
  const cur = currentParaIdx.value
  const edge = 20      // 首尾各保留
  const midHalf = 15   // 当前附近各保留
  const start = Math.max(0, cur - midHalf)
  const end = Math.min(total, cur + midHalf + 1)
  const items: Array<{ type: 'dot' | 'gap'; index: number; key: string }> = []

  // 首部
  for (let i = 0; i < edge && i < start; i++) {
    items.push({ type: 'dot', index: i, key: `s${i}` })
  }
  // 间隙
  if (start > edge + 2) items.push({ type: 'gap', index: -1, key: 'g1' })
  else if (start > edge) {
    for (let i = edge; i < start; i++) items.push({ type: 'dot', index: i, key: `a${i}` })
  }
  // 中部
  for (let i = start; i < end; i++) {
    items.push({ type: 'dot', index: i, key: `m${i}` })
  }
  // 尾部间隙
  if (end < total - edge - 2) items.push({ type: 'gap', index: -1, key: 'g2' })
  else if (end < total - edge) {
    for (let i = end; i < total - edge; i++) items.push({ type: 'dot', index: i, key: `b${i}` })
  }
  // 尾部
  for (let i = Math.max(end, total - edge); i < total; i++) {
    items.push({ type: 'dot', index: i, key: `e${i}` })
  }
  return items
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

// ---- QA 浮动区控制 ----
function onPanelMouseMove(e: MouseEvent) {
  if (qaVisible.value) return
  const panel = e.currentTarget as HTMLElement
  const rect = panel.getBoundingClientRect()
  if (e.clientY >= rect.bottom - 50) {
    showQa()
  }
}

function showQa() {
  qaVisible.value = true
  stopQaHideTimer()
  userAdjustedHeight.value = false
  if (currentParagraphChat.value.length > 0) {
    answerHeight.value = Math.min(200, (qaAreaRef.value?.closest('.qa-panel')?.getBoundingClientRect().height || 400) - 56)
  } else {
    answerHeight.value = 0
    startQaHideTimer()
  }
}

function hideQa() {
  stopQaHideTimer()
  qaVisible.value = false
  qaResizing = false
}

function startQaResize(e: MouseEvent) {
  if (qaResizing) return
  qaResizing = true
  userAdjustedHeight.value = true
  // 捕获当前实际高度作为拖拽起点（border-box 下高度含 padding，与 getBoundingClientRect 一致）
  if (qaAnswerRef.value) {
    answerHeight.value = qaAnswerRef.value.getBoundingClientRect().height
  }
  stopQaHideTimer()
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'

  const startY = e.clientY
  const startH = answerHeight.value

  const SNAP_THRESHOLD = 30
  const QA_SNAP_MIN = 80

  const onMove = (ev: MouseEvent) => {
    if (!qaResizing) return
    const dy = startY - ev.clientY // 往上拖为正
    const newH = startH + dy

    // 向下拖拽：接近折叠态时磁吸归零，重新锚定以便继续向上拖
    if (newH <= SNAP_THRESHOLD) {
      answerHeight.value = 0
      startH = 0
      startY = ev.clientY
      if (!hasAnswerContent.value) startQaHideTimer()
      return
    }

    // 从折叠态向上拖拽：超过阈值后从最小高度起偏移计算，鼠标移动直接映射为高度变化
    const effectiveH = startH === 0
      ? QA_SNAP_MIN + (newH - SNAP_THRESHOLD)
      : newH

    if (effectiveH > 0) stopQaHideTimer()

    const panel = (e.target as HTMLElement).closest('.qa-panel')
    if (panel) {
      const maxH = panel.getBoundingClientRect().height - 56
      answerHeight.value = effectiveH > maxH ? maxH : effectiveH
    } else {
      answerHeight.value = effectiveH
    }
  }

  const cleanup = () => {
    qaResizing = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  const onUp = () => { userAdjustedHeight.value = true; cleanup() }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
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

function handleDoubleClick(para: Paragraph) {
  // 双击：选中单词 → 显示工具条 → 自动发音
  setTimeout(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return
    const word = sel.toString().trim()
    if (word.length < 2 || word.length > 50) return
    article.pronounceWord(word)
  }, 20)
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
  // 切换段落：有问答内容则自动展示，无内容则隐藏
  if (currentParagraphChat.value.length > 0) {
    if (!qaVisible.value) { qaVisible.value = true; stopQaHideTimer() }
  } else {
    hideQa()
  }
  pendingPara = p
  clickTimer = setTimeout(() => {
    if (pendingPara) {
      handleParagraphAction('explain', pendingPara.id, pendingPara.text)
      pendingPara = null
    }
  }, 300)
}

function doCopy(text: string) { navigator.clipboard.writeText(text).catch(() => {}) }

// 段落文本编辑
const editingParagraphId = ref<string | null>(null)
const editText = ref('')
function startEdit(pid: string) {
  const para = paragraphs.value.find(p => p.id === pid)
  if (!para) return
  editingParagraphId.value = pid
  editText.value = para.text
}
function saveEdit(pid: string) {
  const newText = editText.value.trim()
  if (!newText) { editingParagraphId.value = null; editText.value = ''; return }

  // 处理该段落的标记：尝试在新文本中重新定位，定位不到才删除
  const paraMarks = marks.value.filter(m => m.paragraphId === pid)
  const oldText = paragraphs.value.find(p => p.id === pid)?.text || ''
  let marksChanged = false

  for (const m of paraMarks) {
    const markedText = oldText.slice(m.startOffset, m.endOffset)
    const newIdx = newText.indexOf(markedText)
    if (newIdx !== -1 && newIdx === newText.lastIndexOf(markedText)) {
      // 唯一匹配 → 更新 offset
      m.startOffset = newIdx
      m.endOffset = newIdx + markedText.length
      marksChanged = true
    } else {
      // 找不到或有多处匹配 → 删除该标记
      marks.value = marks.value.filter(x => x.id !== m.id)
      marksChanged = true
    }
  }
  if (marksChanged) saveMarks()

  article.updateParagraphText(pid, newText)
  $fetch('/api/text/update-segment', {
    method: 'POST',
    body: { textId: id, segmentId: pid, text: newText },
  }).catch(() => {})
  editingParagraphId.value = null
  editText.value = ''
}
function cancelEdit() {
  editingParagraphId.value = null
  editText.value = ''
}

function focusChatInput() {
  if (!qaVisible.value) { qaVisible.value = true; stopQaHideTimer() }
  nextTick(() => { chatInputEl.value?.focus() })
}

// ---- 加载 ----
onMounted(() => {
  leftWidth.value = Math.floor(window.innerWidth * 0.6)
  rightWidth.value = Math.floor(window.innerWidth * 0.4 - 6)
})
onMounted(async () => {
  try {
    const data = await $fetch<any>(`/api/text/${id}`)
    if (!data?.text) throw new Error('No text')
    source.value = data.source || ''
    article.setRawText(data.text)
    article.setParagraphs(quickSegment(data.text))
    if (data.filePath) pdfUrl.value = `/api/file/${data.filePath}`
    if (data.segments) article.setParagraphs(data.segments)
    if (data.analysis) { article.setAnalysis(data.analysis); showAll(formatMd(data.analysis)) }
    if (data.explanations) for (const [k, v] of Object.entries(data.explanations)) { const [pid, act] = k.split(':'); article.setCachedExplanation(pid, act as any, v as string) }
    if (data.marks) marks.value = data.marks
    if (data.readingPosition) readingPosition.value = data.readingPosition
    if (data.paragraphChats) {
      article.loadParagraphChats(data.paragraphChats)
      for (const pid of Object.keys(data.paragraphChats)) paragraphsWithChats.add(pid)
    }
    if (data.videoSubtitles && Array.isArray(data.videoSubtitles)) {
      originalSubtitles.value = data.videoSubtitles
    }
    if (data.videoMeta) {
      videoMeta.value = data.videoMeta as { url: string; type: string; duration: number }
    }
    if (!data.analysis || !data.segments) {
      try { await runAnalysis(data.text) } catch {
        // runAnalysis 内部已处理兜底和错误提示，此处静默
      }
    }
    const markPid = route.query.mark as string
    if (markPid) { await nextTick(); const el = document.querySelector(`[data-id="${markPid}"]`); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
    $fetch('/api/text/stats', { method: 'POST', body: { id, marks: marks.value.length } }).catch(() => {})
  } catch (e: any) { alert('加载失败'); navigateTo('/') }
})

function goBack() { stopStreaming(); article.reset(); navigateTo('/') }

function goToWatch() {
  navigateTo(`/watch/${id}?from=read${currentTimeForWatch.value > 0 ? `&time=${currentTimeForWatch.value}` : ''}`)
}

function jumpToWatch(para: any) {
  const time = para?.start
  if (time !== undefined) {
    navigateTo(`/watch/${id}?time=${time}`)
  } else {
    navigateTo(`/watch/${id}`)
  }
}

const currentTimeForWatch = computed(() => {
  if (route.query.time) return parseFloat(route.query.time as string) || 0
  return 0
})

function formatCueTime(seconds: number): string {
  if (seconds === undefined || seconds === null) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function quickSegment(text: string): Paragraph[] {
  const blocks = text.split(/\n\s*\n/).filter(b => b.trim())
  if (blocks.length > 1) return splitIntoParagraphs(blocks.join('\n\n'))
  return splitIntoParagraphs(text)
}

/** 按句子拆分并每 4 句合并为一段 */
function splitIntoParagraphs(text: string): Paragraph[] {
  const GROUP = 4
  const prepared = text.replace(/\.{3,}/g, '…')
  const sentences = prepared.split(/(?<=[.!?。！？"」])\s*/)
    .map(s => s.replace(/…/g, '...').trim())
    .filter(s => s.length > 0)
  if (sentences.length <= 1) return [{ id: 'q-0', index: 0, text }]

  const result: Paragraph[] = []
  for (let i = 0; i < sentences.length; i += GROUP) {
    const chunk = sentences.slice(i, i + GROUP).join(' ').trim()
    if (chunk) result.push({ id: `q-${result.length}`, index: result.length, text: chunk })
  }
  // 如果最后一组只剩 1-2 句，合并到前一段
  if (result.length > 1) {
    const lastGroupSize = sentences.length % GROUP
    if (lastGroupSize > 0 && lastGroupSize <= 2) {
      const last = result.pop()!
      result[result.length - 1].text += ' ' + last.text
    }
  }
  return result
}

function formatMd(a: any) { return [`## ${a.title}`, '', `**风格**：${a.tone}`, '', '### 内容摘要', a.summary, '', '### 背景分析', a.background, '', '### 关键要点', ...(a.keyPoints||[]).map((k: string) => `- ${k}`)].join('\n') }

/**
 * 将 AI 分段结果映射回原始字幕 cue，保留时间信息。
 * 对每个 AI 分段文本，在完整字幕拼接文本中定位 → 找到覆盖该位置的字幕 cue →
 * 取第一个 cue 的 start 作为段落时间戳。
 *
 * 匹配时做归一化（小写+去标点），让 AI 添加的标点和大小写不影响定位。
 */
function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[.,!?;:'"()\-\[\]{}<>/\\@#$%^&*~`]/g, '').replace(/\s+/g, ' ').trim()
}

function mapSegmentsToCues(
  segments: Paragraph[],
  cues: Array<{ text: string; start: number; end: number }>,
): Paragraph[] {
  if (!cues.length) return segments

  // 完整拼接文本 + 归一化版本（用于匹配）
  const fullText = cues.map(c => c.text).join(' ').replace(/\s{2,}/g, ' ').trim()
  const normFull = normalizeText(fullText)

  // 构建每个 cue 在归一化文本中的字符范围
  let offset = 0
  const ranges: Array<{ start: number; end: number; cueIdx: number }> = []
  for (let i = 0; i < cues.length; i++) {
    const normCue = normalizeText(cues[i].text)
    const idx = normFull.indexOf(normCue, offset)
    const start = idx >= 0 ? idx : offset
    const end = start + normCue.length
    ranges.push({ start, end, cueIdx: i })
    offset = end + 1
  }

  return segments.map((seg) => {
    // AI 输出文本也做归一化，消除大小写/标点差异
    const segClean = seg.text.replace(/\s+/g, ' ').trim()
    const normSeg = normalizeText(segClean)
    const head = normSeg.slice(0, 60)
    let startPos = normFull.indexOf(head)
    if (startPos < 0) {
      startPos = normFull.indexOf(normSeg.slice(0, 40))
    }
    if (startPos < 0) return seg // 无法定位

    const endPos = startPos + normSeg.length

    // 找到覆盖该范围的 cue
    let firstCue: { text: string; start: number; end: number } | null = null
    let lastCue: { text: string; start: number; end: number } | null = null
    for (const r of ranges) {
      if (r.start <= startPos && r.end > startPos && !firstCue) firstCue = cues[r.cueIdx]
      if (r.start < endPos) lastCue = cues[r.cueIdx]
    }
    if (!firstCue) firstCue = cues[0]
    if (!lastCue) lastCue = cues[cues.length - 1]

    return {
      ...seg,
      start: firstCue?.start,
      end: lastCue?.end,
    }
  })
}

/**
 * 统一的 AI 分析流程：先分析（流式）→ 再分段（专用端点）
 *
 * 分离理由：
 * - 分析需要截断文本 + 流式体验，长文短文都能用
 * - 分段走 segment 端点：短文全文送入、长文截断 + 本地兜底，精度远高于正则挖断点
 * - 两步分开后不互相污染，各自失败有独立兜底
 */
async function runAnalysis(text: string) {
  // ---- 第一步：AI 分析（流式，只出元信息 + 右面板展示） ----
  const maxInput = 15000
  const inputText = text.length > maxInput
    ? text.slice(0, maxInput) + `\n\n[全文共 ${text.length} 字符，此处仅提供前 ${maxInput} 字符用于分析]`
    : text

  const prompt = `你是一位专业的文章分析助手。请分析以下文章并输出：

### 标题
简洁标题（10字以内）

### 风格
学术/科普/叙事/议论 等

### 内容摘要
核心内容概括（100-200字）

### 背景分析
写作背景和上下文

### 关键要点
- 要点一
- 要点二
- 要点三（3-5个）

## 文章内容
${inputText}

请严格按上述格式输出，直接从 "### 标题" 开始。`

  const msgs = [
    { role: 'system' as const, content: '按格式输出，禁止开场白。直接从 ### 开始。' },
    { role: 'user' as const, content: prompt },
  ]
  let full = ''

  startStreaming('')
  try {
    await deepseek.streamExplain(msgs, (chunk: string) => { full += chunk; appendText(chunk) })
    endStream()

    const a = {
      title: (full.match(/### 标题\n(.+)/)?.[1] || '').trim(),
      tone: (full.match(/### 风格\n(.+)/)?.[1] || '').trim(),
      summary: (full.match(/### 内容摘要\n([\s\S]+?)(?=\n###|$)/)?.[1] || '').trim(),
      background: (full.match(/### 背景分析\n([\s\S]+?)(?=\n###|$)/)?.[1] || '').trim(),
      keyPoints: (full.match(/### 关键要点\n([\s\S]+?)(?=\n###|$)/)?.[1] || '')
        .split('\n').filter((s: string) => s.trim().startsWith('-')).map((s: string) => s.replace(/^-\s*/, '')),
    }
    article.setAnalysis(a)
    $fetch('/api/text/update', { method: 'POST', body: { id, analysis: a } }).catch(() => {})
  } catch (err: any) {
    stopStreaming()
    const reason = err?.message || '未知错误'
    console.error('AI 分析失败:', reason)
    progressMsg.value = `AI 分析失败（${reason}），继续分段…`
  }

  // ---- 第二步：AI 分段（按来源类型走不同策略） ----
  try {
    const segType = isVideo.value ? 'subtitle' : 'document'
    let segs = await $fetch<Paragraph[]>('/api/deepseek/segment', {
      method: 'POST',
      body: { text, type: segType },
    })

    // 视频字幕：将 AI 分段映射回原始字幕时间轴
    if (isVideo.value && originalSubtitles.value?.length) {
      segs = mapSegmentsToCues(segs, originalSubtitles.value)
    }

    article.setParagraphs(segs)
    article.clearParagraphCaches()
    // 保存分段 + 清除数据库中的旧解释和对话
    $fetch('/api/text/update', { method: 'POST', body: { id, segments: segs, explanations: {}, paragraphChats: {} } }).catch(() => {})
  } catch (err: any) {
    // segment 端点内部已有 fallback，此处额外的兜底
    const fallbackSegs = splitIntoParagraphs(text)
    article.setParagraphs(fallbackSegs)
    article.clearParagraphCaches()
    $fetch('/api/text/update', { method: 'POST', body: { id, segments: fallbackSegs, explanations: {}, paragraphChats: {} } }).catch(() => {})
    const reason = err?.message || '未知错误'
    progressMsg.value = `分段失败（${reason}），已使用本地分段。`
    progressError.value = true
    throw err
  }
}

const analyzing = ref(false)

// ── 书内搜索 ──
const searchVisible = ref(false)
const searchText = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const searchMatches = ref<Array<{ paraId: string; paraIdx: number; text: string }>>([])
const currentMatchIdx = ref(0)

function toggleSearch() {
  searchVisible.value = !searchVisible.value
  if (searchVisible.value) {
    nextTick(() => searchInputRef.value?.focus())
  } else {
    searchText.value = ''
    searchMatches.value = []
    currentMatchIdx.value = 0
    clearHighlights()
  }
}

function doSearch() {
  const q = searchText.value.trim().toLowerCase()
  searchMatches.value = []
  currentMatchIdx.value = 0
  clearHighlights()
  if (!q || q.length < 2) return

  const results: typeof searchMatches.value = []
  for (let i = 0; i < paragraphs.value.length; i++) {
    const p = paragraphs.value[i]
    if (p.text.toLowerCase().includes(q)) {
      results.push({ paraId: p.id, paraIdx: i, text: p.text })
    }
  }
  searchMatches.value = results
  if (results.length > 0) {
    currentMatchIdx.value = 0
    scrollToMatch(0)
  }
}

function nextMatch() {
  if (!searchMatches.value.length) return
  currentMatchIdx.value = (currentMatchIdx.value + 1) % searchMatches.value.length
  scrollToMatch(currentMatchIdx.value)
}

function prevMatch() {
  if (!searchMatches.value.length) return
  currentMatchIdx.value = (currentMatchIdx.value - 1 + searchMatches.value.length) % searchMatches.value.length
  scrollToMatch(currentMatchIdx.value)
}

function scrollToMatch(idx: number) {
  const m = searchMatches.value[idx]
  if (!m) return
  const el = document.querySelector(`[data-id="${m.paraId}"]`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    highlightMatch(m.paraId)
  }
}

function highlightMatch(paraId: string) {
  clearHighlights()
  const el = document.querySelector(`[data-id="${paraId}"]`)
  if (el) el.classList.add('search-highlight')
}

function clearHighlights() {
  document.querySelectorAll('.search-highlight').forEach(el => el.classList.remove('search-highlight'))
}

// Ctrl+F 快捷键
function onKeyDown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault()
    searchVisible.value = true
    nextTick(() => searchInputRef.value?.focus())
  }
  if (e.key === 'Escape' && searchVisible.value) {
    searchVisible.value = false
    searchText.value = ''
    searchMatches.value = []
    clearHighlights()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
})

const progressError = ref(false)

function dismissProgress() {
  progressMsg.value = ''
  progressError.value = false
}

async function runManualAnalysis() {
  if (analyzing.value || !article.rawText.value) return
  analyzing.value = true
  article.isProcessingWritable.value = true
  progressError.value = false
  progressMsg.value = 'AI 正在分析文章…'
  try {
    await runAnalysis(article.rawText.value)
    progressMsg.value = '分析完成'
    progressError.value = false
  } catch {
    // runAnalysis 内部已设置错误信息
  } finally {
    analyzing.value = false
    article.isProcessingWritable.value = false
    if (!progressError.value) {
      setTimeout(() => { progressMsg.value = '' }, 3000)
    }
  }
}

const pendingExplain = ref('')

/**
 * 从段落文本在原文中定位页码。
 * 原文每页起始处有 [PAGE:N] 标记，从段落位置往回搜索最近的标记。
 * 性能：单次 lastIndexOf，O(n) 但对百万字文本也是微秒级。
 */
function locateParagraphPage(para: Paragraph): number | null {
  const fullText = article.rawText.value
  if (!fullText) return null
  // 在原文中查找段落起始位置（用前 60 字符精确匹配）
  const pos = fullText.indexOf(para.text.replace(/\s+/g, ' ').trim().slice(0, 60))
  if (pos < 0) return null
  // 从该位置往回搜索最近的 [PAGE:N] 标记
  const prefix = fullText.slice(0, pos)
  const matches = [...prefix.matchAll(/\[PAGE:(\d+)\]/g)]
  if (matches.length === 0) return null
  return parseInt(matches[matches.length - 1][1], 10)
}

function openPdfAtParagraph(para: Paragraph) {
  const page = locateParagraphPage(para)
  if (page !== null) {
    pdfPage.value = page
  } else {
    pdfPage.value = null
  }
  showPdf.value = true
}

/** 整理段落：补标点、分句、排版 */
const cleaningPara = ref<string | null>(null)
async function cleanParagraph(pid: string, ptext: string) {
  if (cleaningPara.value) return
  cleaningPara.value = pid
  try {
    const { cleaned } = await $fetch<{ cleaned: string }>('/api/deepseek/clean', {
      method: 'POST',
      body: { text: ptext },
    })
    if (cleaned && cleaned !== ptext) {
      article.updateParagraphText(pid, cleaned)
      // 清除此段落缓存（文本变了，旧解释可能不准确）
      article.setCachedExplanation(pid, 'explain', '')
      article.setCachedExplanation(pid, 'translate', '')
      // 持久化到 DB
      $fetch('/api/text/update-segment', {
        method: 'POST',
        body: { textId: id, segmentId: pid, text: cleaned },
      }).catch(() => {})
    }
  } catch (e: any) {
    // 静默失败，不打断阅读
  } finally {
    cleaningPara.value = null
  }
}

/** 重新分析段落：清除缓存 → 强制重新请求 AI */
function reAnalyzeParagraph(pid: string, ptext: string) {
  article.setCachedExplanation(pid, 'explain', '')
  article.setCachedExplanation(pid, 'translate', '')
  handleParagraphAction('explain', pid, ptext)
}

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
    : `深度解读以下段落，结合文章背景。用 Markdown 输出三部分：

### 一、整体翻译

### 二、难点词汇解析
用表格输出，列名为：| 词汇 | 释义 | 语境理解 |
其中"语境理解"为该词在当前段落语境中的具体含义和用法。

### 三、段落精讲

文章背景：${article.getArticleContext()}

段落：${ptext}`
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
    // savedVocab 已改为 computed 自动从 marks 提取，无需手动插入
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

// 持久化所有段落的对话历史
function saveChats() {
  const chats = article.getAllParagraphChats()
  if (Object.keys(chats).length === 0) return
  $fetch('/api/text/update', { method: 'POST', body: { id, paragraphChats: chats } }).catch(() => {})
}

async function sendChat() {
  const msg = chatInput.value.trim(); if (!msg || chatLoading.value) return
  const pid = activeParagraphId.value; if (!pid) return
  // 确保 QA 可见并有足够高度
  if (!qaVisible.value) showQa()
  userAdjustedHeight.value = false
  if (answerHeight.value < 80) { answerHeight.value = 80; stopQaHideTimer() }
  const para = paragraphs.value.find(p => p.id === pid)
  const ctx = [para ? `段落原文：\n${para.text}` : '', rightPanelContent.value ? `分析内容：\n${rightPanelContent.value}` : ''].filter(Boolean).join('\n\n')
  const um: ChatMessage = { role: 'user', content: msg }; article.addParagraphChatMessage(pid, um); saveChats(); paragraphsWithChats.add(pid); chatLoading.value = true; chatInput.value = ''
  const systemMsg = { role: 'system' as const, content: `你是专注的阅读导师。结合文章背景和当前段落回答用户问题。\n\n文章背景：${article.getArticleContext()}\n\n当前段落上下文：${ctx}` }
  const messages = [systemMsg, ...article.getParagraphChat(pid)]
  let fullReply = ''; startChatStream('')
  try {
    await deepseek.streamExplain(messages, (chunk: string) => { fullReply += chunk; appendChatText(chunk) })
    endChatStream()
    const am: ChatMessage = { role: 'assistant', content: fullReply }; article.addParagraphChatMessage(pid, am); saveChats()
  } catch (e: any) { stopChatStream() }
  finally { chatLoading.value = false; nextTick(() => { if (qaAnswerRef.value) qaAnswerRef.value.scrollTop = qaAnswerRef.value.scrollHeight }) }
}

onUnmounted(() => { if (clickTimer) clearTimeout(clickTimer); })
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

/* 阅读位置标记 — 淡蓝底色 + 脉冲扩散 */
.para-num.pos-marker {
  background: #93c5fd !important;
  color: #ffffff !important;
  box-shadow: 0 0 0 4px rgba(147,197,253,0.25);
  animation: pulsePos 2s infinite;
}
@keyframes pulsePos {
  0%, 100% { box-shadow: 0 0 0 4px rgba(147,197,253,0.25); }
  50% { box-shadow: 0 0 0 10px rgba(147,197,253,0); }
}

/* 段落编辑区 */
.para-edit-area {
  font-family: 'Lora', Georgia, serif;
  font-size: 15px; line-height: 1.82;
  color: #1a1a18;
  flex: 1;
  border: 1.5px solid #3d3591;
  border-radius: 8px;
  padding: 8px 12px;
  resize: vertical;
  outline: none;
  background: #fafaf8;
}

/* 编辑确认按钮 — 绿色 */
.para-action-btn.edit-confirm {
  color: #10b981;
  border-color: #10b981;
  background: #ecfdf5;
}
.para-action-btn.edit-confirm:hover {
  background: #d1fae5;
}

/* 播放中音频波动画 */
.playing-bars {
  display: flex; align-items: flex-end; gap: 2px; height: 12px;
}
.playing-bar {
  width: 2px; background: #3d3591; border-radius: 1px;
  animation: barPulse 0.5s ease-in-out infinite alternate;
}
@keyframes barPulse {
  0% { height: 4px; }
  100% { height: 12px; }
}

/* 行内小 spinner（段落工具条用） */
.mini-spinner-inline {
  width: 13px; height: 13px;
  border: 1.5px solid #e2e8f0;
  border-top-color: #3d3591;
  border-radius: 50%;
  animation: spinInline 0.6s linear infinite;
}

@keyframes spinInline {
  to { transform: rotate(360deg); }
}

/* 问答历史标记 — 序号下方紫色圆点 */
.para-num.has-chat {
  position: relative;
}
.para-num.has-chat::after {
  content: '';
  position: absolute;
  bottom: -5px;
  left: 50%;
  transform: translateX(-50%);
  width: 5px; height: 5px;
  border-radius: 50%;
  background: #3d3591;
}

/* ---- QA 浮动区 ---- */
.qa-panel { position: relative; }

.qa-area {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: #f0efe9;
  border-top: 0.5px solid rgba(0,0,0,0.08);
  box-shadow: 0 -4px 12px rgba(0,0,0,0.06);
    z-index: 10;
}

.qa-resize-handle {
  height: 8px;
  cursor: row-resize;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  z-index: 2;
}
.qa-resize-handle::before,
.qa-resize-handle::after {
  content: '';
  width: 3px; height: 3px;
  border-radius: 50%;
  background: #c4c1ba;
  transition: background 0.15s;
}
/* 中间的点通过 box-shadow 生成 */
.qa-resize-handle::before {
  box-shadow: 6px 0 0 #c4c1ba, -6px 0 0 #c4c1ba;
}
.qa-resize-handle:hover::before,
.qa-resize-handle:hover::after {
  background: #3d3591;
}
.qa-resize-handle:hover::before {
  box-shadow: 6px 0 0 #3d3591, -6px 0 0 #3d3591;
}

.qa-answer {
  box-sizing: border-box;
  overflow-y: auto;
  flex: 0 1 auto;
  min-height: 0;
  padding: 8px 14px;
  scrollbar-width: none;
}
.qa-answer::-webkit-scrollbar {
  display: none;
}

.qa-input-row {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 0.5px solid rgba(0,0,0,0.08);
  background: #f0efe9;
}

/* typing cursor */
.typing-cursor { display: inline; color: #3d3591; animation: blink 0.8s infinite; font-weight: 100; }
@keyframes blink { 0%,50%{opacity:1} 51%,100%{opacity:0} }

/* QA slide transition */
.qa-slide-enter-active {
  transition: transform 0.25s linear, opacity 0.25s linear;
}
.qa-slide-leave-active {
  transition: transform 0.15s linear, opacity 0.15s linear;
}
.qa-slide-enter-from,
.qa-slide-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
/* ── 书内搜索条 ── */
.search-bar {
  flex-shrink: 0;
  padding: 0 32px 8px;
}
.search-bar-inner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: #f8f9fb;
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 10px;
}
.search-bar-icon { color: #a09e97; flex-shrink: 0; }
.search-bar-input {
  flex: 1;
  border: none; background: transparent;
  font-size: 13px; font-family: 'DM Sans', sans-serif;
  color: #1a1a18; outline: none;
}
.search-bar-input::placeholder { color: #c0bdb4; }
.search-bar-count {
  font-size: 11px;
  color: #a09e97;
  font-family: 'DM Mono', monospace;
  min-width: 32px;
  text-align: center;
}
.search-bar-nav {
  width: 24px; height: 24px;
  border: none; border-radius: 6px;
  background: rgba(0,0,0,0.04);
  color: #6b6963;
  font-size: 11px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.search-bar-nav:hover { background: rgba(0,0,0,0.08); }
.search-bar-nav:disabled { opacity: 0.3; cursor: default; }
.search-bar-close {
  width: 24px; height: 24px;
  border: none; border-radius: 50%;
  background: transparent;
  color: #a09e97;
  font-size: 16px;
  cursor: pointer;
}
.search-bar-close:hover { background: rgba(0,0,0,0.06); }
.search-highlight {
  background: rgba(245, 158, 11, 0.15) !important;
  border-radius: 4px;
  transition: background 0.2s;
}

</style>
