import type {
  Paragraph,
  ArticleAnalysis,
  ChatMessage,
  ParagraphAction,
} from '#shared/types'

// 全局文章状态管理
const rawText = ref('')
const title = ref('')
const paragraphs = ref<Paragraph[]>([])
const analysis = ref<ArticleAnalysis | null>(null)
const chatHistory = ref<ChatMessage[]>([])
const activeParagraphId = ref<string | null>(null)
const rightPanelContent = ref('')
const rightPanelAction = ref<ParagraphAction | 'analyze' | 'chat'>('analyze')
const isProcessing = ref(false)

// ---- 段落解释缓存 ----
// key: `${paragraphId}:${action}` → 已缓存的分析结果
const explanationCache = new Map<string, string>()

// 每个段落独立的对话历史
// key: paragraphId → ChatMessage[]
const paragraphChats = new Map<string, ChatMessage[]>()

// 当前显示的段落的对话（用于 AnalysisPanel）
const currentParagraphChat = ref<ChatMessage[]>([])

function getCacheKey(paragraphId: string, action: ParagraphAction | 'chat') {
  return `${paragraphId}:${action}`
}

function getCachedExplanation(paragraphId: string, action: ParagraphAction): string | null {
  return explanationCache.get(getCacheKey(paragraphId, action)) || null
}

function setCachedExplanation(paragraphId: string, action: ParagraphAction, content: string) {
  explanationCache.set(getCacheKey(paragraphId, action), content)
}

function getParagraphChat(paragraphId: string): ChatMessage[] {
  return paragraphChats.get(paragraphId) || []
}

function setParagraphChat(paragraphId: string, messages: ChatMessage[]) {
  paragraphChats.set(paragraphId, messages)
}

function addParagraphChatMessage(paragraphId: string, message: ChatMessage) {
  const existing = getParagraphChat(paragraphId)
  existing.push(message)
  setParagraphChat(paragraphId, existing)
  // 同步更新 currentParagraphChat
  if (activeParagraphId.value === paragraphId) {
    currentParagraphChat.value = [...existing]
  }
}

function loadParagraphChats(data: Record<string, ChatMessage[]>) {
  for (const [pid, msgs] of Object.entries(data)) {
    paragraphChats.set(pid, [...msgs])
  }
  // 如果当前活跃段落有已存储的聊天，同步到 currentParagraphChat
  if (activeParagraphId.value && paragraphChats.has(activeParagraphId.value)) {
    currentParagraphChat.value = [...paragraphChats.get(activeParagraphId.value)!]
  }
}

function getAllParagraphChats(): Record<string, ChatMessage[]> {
  const result: Record<string, ChatMessage[]> = {}
  for (const [pid, msgs] of paragraphChats.entries()) {
    result[pid] = msgs
  }
  return result
}

function updateParagraphText(paragraphId: string, text: string) {
  const idx = paragraphs.value.findIndex(p => p.id === paragraphId)
  if (idx !== -1) {
    paragraphs.value[idx] = { ...paragraphs.value[idx], text }
  }
}

// 发音 API 基础 URL
const PRONUNCIATION_BASE = 'https://audio.beingfine.cn/speeches/UK/UK-speech'

export function useArticle() {
  function setRawText(text: string) {
    rawText.value = text
  }

  function setParagraphs(segs: Paragraph[]) {
    paragraphs.value = segs
  }

  function setAnalysis(a: ArticleAnalysis) {
    analysis.value = a
    title.value = a.title
  }

  function setActiveParagraph(id: string | null) {
    activeParagraphId.value = id
    // 切换段落时加载该段落的对话历史
    if (id) {
      currentParagraphChat.value = [...getParagraphChat(id)]
    } else {
      currentParagraphChat.value = []
    }
  }

  function setRightContent(content: string, action: ParagraphAction | 'analyze' | 'chat') {
    rightPanelContent.value = content
    rightPanelAction.value = action
  }

  function addChatMessage(message: ChatMessage) {
    chatHistory.value.push(message)
  }

  function getArticleContext(): string {
    const parts: string[] = []
    if (title.value) parts.push(`文章标题：${title.value}`)
    if (analysis.value) {
      parts.push(`文章摘要：${analysis.value.summary}`)
      parts.push(`文章背景：${analysis.value.background}`)
      parts.push(`文章风格：${analysis.value.tone}`)
      parts.push(`关键要点：${analysis.value.keyPoints.join('；')}`)
    }
    return parts.join('\n')
  }

  function getPronunciationUrl(word: string): string {
    const clean = word.replace(/[^a-zA-Z]/g, '').toLowerCase()
    return `${PRONUNCIATION_BASE}/${clean}.mp3`
  }

  function pronounceWord(word: string) {
    if (!import.meta.client) return
    const audio = new Audio(getPronunciationUrl(word))
    audio.play().catch(() => {
      const utterance = new SpeechSynthesisUtterance(word)
      utterance.lang = 'en-GB'
      utterance.rate = 0.85
      speechSynthesis.speak(utterance)
    })
  }

  /** 分段变更后清除所有旧段落相关的缓存（解释、对话） */
  function clearParagraphCaches() {
    explanationCache.clear()
    paragraphChats.clear()
    currentParagraphChat.value = []
    rightPanelContent.value = ''
    rightPanelAction.value = 'analyze'
    activeParagraphId.value = null
  }

  function reset() {
    rawText.value = ''
    title.value = ''
    paragraphs.value = []
    analysis.value = null
    chatHistory.value = []
    activeParagraphId.value = null
    rightPanelContent.value = ''
    rightPanelAction.value = 'analyze'
    isProcessing.value = false
    explanationCache.clear()
    paragraphChats.clear()
    currentParagraphChat.value = []
  }

  return {
    // 状态
    rawText: readonly(rawText),
    title: readonly(title),
    paragraphs: readonly(paragraphs),
    analysis: readonly(analysis),
    chatHistory: readonly(chatHistory),
    activeParagraphId: readonly(activeParagraphId),
    rightPanelContent: readonly(rightPanelContent),
    rightPanelAction: readonly(rightPanelAction),
    isProcessing: readonly(isProcessing),
    currentParagraphChat: readonly(currentParagraphChat),
    // 方法
    setRawText,
    setParagraphs,
    setAnalysis,
    setActiveParagraph,
    setRightContent,
    addChatMessage,
    getArticleContext,
    getPronunciationUrl,
    pronounceWord,
    reset,
    clearParagraphCaches,
    isProcessingWritable: isProcessing,
    // 缓存
    getCachedExplanation,
    setCachedExplanation,
    getParagraphChat,
    setParagraphChat,
    addParagraphChatMessage,
    loadParagraphChats,
    getAllParagraphChats,
    updateParagraphText,
    currentParagraphChatWritable: currentParagraphChat,
  }
}
