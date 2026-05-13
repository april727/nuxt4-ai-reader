export interface Paragraph {
  id: string; index: number; text: string
}

export interface ArticleAnalysis {
  title: string; summary: string; background: string; tone: string; keyPoints: string[]
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'; content: string
}

export type ParagraphAction = 'translate' | 'explain' | 'search'

export type MarkType = 'word' | 'phrase' | 'sentence'

export const MARK_COLORS: Record<MarkType, string> = {
  word: '#f59e0b',      // 黄
  phrase: '#10b981',    // 绿
  sentence: '#06b6d4',  // 青
}

export interface Mark {
  id: string
  paragraphId: string
  startOffset: number
  endOffset: number
  text: string
  type: MarkType
  color: string
  detail: string
  note: string
  createdAt: string
}

export interface ReadingPosition {
  paragraphId: string
  updatedAt: string
}

// API
export interface AnalyzeRequest { text: string; title?: string }
export interface ParagraphActionRequest {
  paragraph: string; action: ParagraphAction; articleContext: string; chatHistory?: ChatMessage[]
}
export interface ChatRequest {
  messages: ChatMessage[]; articleContext: string; paragraphContext?: string
}
export interface MarkExplainRequest {
  text: string; type: MarkType; paragraphContext: string; articleContext: string
}
