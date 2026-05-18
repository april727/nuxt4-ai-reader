import type { SubtitleCue } from '#shared/types'

/** 将字幕列表拼接为纯文本（句间空格分隔） */
export function subtitlesToText(cues: SubtitleCue[]): string {
  return cues.map(c => c.text).join(' ').replace(/\s{2,}/g, ' ').trim()
}

/** 格式化时间为 MM:SS 或 H:MM:SS */
export function formatTime(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 安全的 JSON.parse，失败返回空对象 */
export function safeParse<T>(json: string | undefined | null, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) } catch { return fallback }
}
