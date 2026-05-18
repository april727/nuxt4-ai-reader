import type { SubtitleCue } from '#shared/types'

// ---- SRT 解析 ----

export function parseSRT(content: string): SubtitleCue[] {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  const blocks = normalized.split(/\n\n+/).filter(Boolean)
  const cues: SubtitleCue[] = []

  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean)
    if (lines.length < 3) continue

    // Line 1: index (optional, may be missing)
    let timeLineIdx = 0
    if (/^\d+$/.test(lines[0].trim())) timeLineIdx = 1

    if (timeLineIdx >= lines.length) continue
    const timeLine = lines[timeLineIdx]
    const textLines = lines.slice(timeLineIdx + 1)

    const match = timeLine.match(
      /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/
    )
    if (!match) continue

    const start = toSeconds(match[1], match[2], match[3], match[4])
    const end = toSeconds(match[5], match[6], match[7], match[8])
    const text = textLines.join(' ').replace(/\s{2,}/g, ' ').trim()
    if (!text) continue

    cues.push({ id: `cue_${cues.length}`, index: cues.length, start, end, text })
  }

  return cues
}

// ---- VTT 解析 ----

export function parseVTT(content: string): SubtitleCue[] {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  // Strip WEBVTT header and metadata
  const body = normalized.replace(/^WEBVTT.*?\n\n/, '').replace(/^WEBVTT.*?\n/, '')
  const blocks = body.split(/\n\n+/).filter(Boolean)
  const cues: SubtitleCue[] = []

  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean)
    if (lines.length < 2) continue

    // Find the timing line (contains -->)
    const timeLineIdx = lines.findIndex(l => l.includes('-->'))
    if (timeLineIdx === -1) continue

    const timeLine = lines[timeLineIdx]
    const textLines = lines.slice(timeLineIdx + 1)

    const match = timeLine.match(
      /(\d{1,2}):(\d{2}):(\d{2})[.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.](\d{1,3})/
    )
    if (!match) continue

    const start = toSeconds(match[1], match[2], match[3], match[4])
    const end = toSeconds(match[5], match[6], match[7], match[8])
    const text = textLines.join(' ').replace(/\s{2,}/g, ' ').trim()
    if (!text) continue

    cues.push({ id: `cue_${cues.length}`, index: cues.length, start, end, text })
  }

  return cues
}

// ---- 自动检测格式 ----

export function parseSubtitles(content: string): SubtitleCue[] {
  const trimmed = content.trim()
  const raw = trimmed.startsWith('WEBVTT') ? parseVTT(content) : parseSRT(content)
  return deduplicateSubtitles(raw)
}

/**
 * 移除 YouTube 自动字幕的滚动窗口重叠。
 *
 * 自动字幕常见问题：
 *   Cue 1: "unfixed thing inside of them. On the"
 *   Cue 2: "unfixed thing inside of them. On the other hand, the healthiest fixes are"
 *   （Cue 1 的文本完全包含在 Cue 2 中 → 丢弃 Cue 1）
 *
 *   Cue 3: "other hand, the healthiest fixes are"
 *   Cue 4: "other hand, the healthiest fixes are those who fell in love..."
 *   （Cue 4 以 Cue 3 开头 → 从 Cue 4 中去除重叠前缀）
 */
function deduplicateSubtitles(cues: SubtitleCue[]): SubtitleCue[] {
  if (cues.length <= 1) return cues

  const clean = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase()
  const result: SubtitleCue[] = []

  for (let i = 0; i < cues.length; i++) {
    const current = cues[i]

    // 情况 A：当前 cue 文本完全包含在之后 5 个 cue 中 → 跳过
    // YouTube 滚动窗口的重叠可能跨多个 cue（非紧邻），扩大检测窗口
    let containedInFuture = false
    const checkWindow = 8
    for (let j = i + 1; j < Math.min(i + 1 + checkWindow, cues.length); j++) {
      const futureClean = clean(cues[j].text)
      const curClean = clean(current.text)
      if (futureClean.includes(curClean) && futureClean.length > curClean.length) {
        containedInFuture = true
        break
      }
    }
    if (containedInFuture) continue

    // 情况 B：当前 cue 的文本是前一个结果 cue 的前缀 → 去掉重叠部分
    if (result.length > 0) {
      const prevClean = clean(result[result.length - 1].text)
      const curClean = clean(current.text)
      if (curClean.startsWith(prevClean) && curClean.length > prevClean.length) {
        // 从当前文本中去掉前一个 cue 的完整文本
        const overlapLen = result[result.length - 1].text.length
        const trimmed = current.text.slice(overlapLen).trim()
        if (trimmed) {
          result.push({ ...current, text: trimmed })
        }
        continue
      }
      // 部分前缀重叠（前一个 cue 的尾部和当前 cue 的头部重叠）
      const overlap = findOverlap(prevClean, curClean)
      if (overlap.length > 3) {
        const trimmed = current.text.slice(overlap.length).trim()
        if (trimmed) {
          result.push({ ...current, text: trimmed })
        }
        continue
      }
    }

    result.push(current)
  }

  // 重新编号
  return result.map((c, idx) => ({ ...c, id: `cue_${idx}`, index: idx }))
}

/** 找两个字符串的自然重叠：prev 的末尾和 cur 的开头有多少字符相同 */
function findOverlap(prev: string, cur: string, minLen = 3): string {
  const maxOverlap = Math.min(prev.length, cur.length, 50)
  for (let len = maxOverlap; len >= minLen; len--) {
    const prevTail = prev.slice(-len)
    if (cur.startsWith(prevTail)) {
      return prevTail
    }
  }
  return ''
}

// ---- 时间工具 ----

function toSeconds(h: string, m: string, s: string, ms: string): number {
  const msPadded = ms.padEnd(3, '0').slice(0, 3)
  return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10) + parseInt(msPadded, 10) / 1000
}

export function secondsToTimeStr(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = Math.floor(totalSeconds % 60)
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}
