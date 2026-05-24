export interface Paragraph {
  id: string; index: number; text: string
  images?: string[]  // 段落关联图片的文件名列表
  start?: number; end?: number  // 视频字幕时间戳
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
  lemma: string        // 原词（仅 word 类型，AI 返回的未变形基本形式）
  type: MarkType
  color: string
  detail: string
  note: string
  createdAt: string
}

export interface ReadingPosition {
  paragraphId: string
  updatedAt: string
  videoTime?: number
}

// ---- 视频/音频字幕 ----

export interface SubtitleCue {
  id: string
  index: number
  start: number
  end: number
  text: string
}

export interface SubtitlePractice {
  cueId: string
  repeatCount: number
  mastered: boolean
  lastPracticed: string
}

export interface VideoMeta {
  url: string
  type: 'youtube' | 'bilibili' | 'video_file' | 'audio_file'
  duration: number
  thumbnail?: string
  originalFileName?: string
}

export type VideoSourceType = 'youtube' | 'bilibili' | 'video_file' | 'audio_file'

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
