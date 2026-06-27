import { queryOne, runQuery } from '../../utils/db'
import { safeParse } from '../../utils/subtitle'
import type { SubtitleCue } from '#shared/types'

/** 内存追踪：正在分段中的文本 ID */
export const segmentInProgress = new Set<string>()

/** 词级模糊匹配：将 AI 段落映射回原始字幕 cue 范围，返回首尾时间 */
function mapSegmentsToCues(
  segs: Array<{ id: string; index: number; text: string }>,
  cues: SubtitleCue[],
): Array<{ id: string; index: number; text: string; start?: number; end?: number }> {
  function norm(s: string): string {
    return s.toLowerCase().replace(/[.,!?;:'"()\-\[\]{}<>/\\@#$%^&*~`]/g, '').replace(/\s+/g, ' ').trim()
  }
  function wordOverlap(a: string, b: string): number {
    const wa = norm(a).split(' ').filter(w => w.length > 1)
    const wb = new Set(norm(b).split(' ').filter(w => w.length > 1))
    return wa.filter(w => wb.has(w)).length
  }

  return segs.map((seg, segIdx) => {
    const words = norm(seg.text).split(' ')
    const head = words.slice(0, 5).join(' ')
    const tail = words.slice(-5).join(' ')

    // 匹配起始 cue
    let first = 0, best = 0
    for (let i = 0; i < cues.length; i++) {
      const s = wordOverlap(head, cues[i].text)
      if (s > best) { best = s; first = i }
    }

    // 匹配结束 cue
    let last = first
    best = 0
    for (let i = first; i < cues.length; i++) {
      const s = wordOverlap(tail, cues[i].text)
      if (s > best) { best = s; last = i }
    }
    if (best === 0 && segIdx < segs.length - 1) {
      const nextHead = norm(segs[segIdx + 1].text).split(' ').slice(0, 5).join(' ')
      best = 0
      for (let i = first; i < cues.length; i++) {
        const s = wordOverlap(nextHead, cues[i].text)
        if (s > best) { best = s; last = i - 1 }
      }
      if (last < first) last = Math.min(first + Math.ceil(cues.length / segs.length), cues.length - 1)
    }

    return { ...seg, start: cues[first]?.start, end: cues[last]?.end }
  })
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    id: string
    mode?: 'podcast' | 'standard'
    size?: { minSentences: number; maxSentences: number } | null
  }>(event)

  const id = body?.id
  if (!id) throw createError({ statusCode: 400, message: '缺少文本 ID' })

  // 从 DB 读取文本
  const row = await queryOne('SELECT text, source, videoSubtitles FROM texts WHERE id=?', [id])
  if (!row) throw createError({ statusCode: 404, message: '文本不存在' })

  const rawText = row.text || ''
  if (!rawText.trim()) throw createError({ statusCode: 400, message: '文本内容为空' })

  const source = row.source || ''
  const isVideo = ['youtube', 'bilibili', 'video_file', 'audio_file'].includes(source)

  // 已在分段中则跳过
  if (segmentInProgress.has(id)) {
    return { status: 'already_running' }
  }

  // 后台执行分段，立即返回
  segmentInProgress.add(id)
  runAsyncSegment(id, rawText, isVideo, body.mode || 'standard', body.size || null, row)
    .catch(err => console.error(`[segment-async] ${id} 后台分段失败:`, err.message))
    .finally(() => segmentInProgress.delete(id))

  return { status: 'started' }
})

async function runAsyncSegment(
  id: string,
  text: string,
  isVideo: boolean,
  mode: string,
  size: { minSentences: number; maxSentences: number } | null,
  row: any,
) {
  let segments: Array<{ id: string; index: number; text: string; start?: number; end?: number }> = []

  try {
    if (mode === 'podcast') {
      const result = await $fetch<{
        segments: Array<{ index: number; label: string; text: string }>
        analysis: string
        notes: string
      }>('/api/deepseek/podcast-full', {
        method: 'POST',
        body: { text },
      })

      segments = result.segments.map((s, i) => ({ id: `p-${i}`, index: i, text: s.text }))

      // 视频字幕：映射回原始时间轴
      if (isVideo) {
        const originalSubtitles = safeParse<SubtitleCue[]>(row.videoSubtitles, [])
        if (originalSubtitles.length > 0) {
          segments = mapSegmentsToCues(segments, originalSubtitles)
        }
      }

      // 保存笔记
      if (result.notes) {
        await runQuery('UPDATE texts SET notes=? WHERE id=?', [result.notes, id])
      }
    } else {
      const segType = isVideo ? 'subtitle' : 'document'
      const segResult = await $fetch<Array<{ id: string; index: number; text: string }>>('/api/deepseek/segment', {
        method: 'POST',
        body: size ? { text, type: segType, size } : { text, type: segType },
      })
      segments = segResult

      // 字幕：AI 分段后映射回原始时间轴
      if (isVideo) {
        const originalSubtitles = safeParse<SubtitleCue[]>(row.videoSubtitles, [])
        if (originalSubtitles.length > 0) {
          segments = mapSegmentsToCues(segments, originalSubtitles)
        }
      }
    }

    // 更新 DB
    await runQuery(
      `UPDATE texts SET segments=?, explanations=?, paragraphChats=? WHERE id=?`,
      [JSON.stringify(segments), '', '', id],
    )
    console.log(`[segment-async] ${id} 分段完成: ${segments.length} 段`)
  } catch (err: any) {
    console.error(`[segment-async] ${id} 分段失败:`, err.message)
    // 失败时写入本地兜底分段
    try {
      const fallbackResult = await $fetch<Array<{ id: string; index: number; text: string }>>('/api/deepseek/segment', {
        method: 'POST',
        body: { text, type: isVideo ? 'subtitle' : 'document' },
      })
      await runQuery(
        `UPDATE texts SET segments=?, explanations=?, paragraphChats=? WHERE id=?`,
        [JSON.stringify(fallbackResult), '', '', id],
      )
    } catch { /* 彻底失败，保持原样 */ }
  }
}
