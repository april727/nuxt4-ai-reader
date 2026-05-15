import { getDb } from '../../utils/db'
import { safeParse } from '../../utils/subtitle'
import type { SubtitleCue, SubtitlePractice, VideoMeta } from '#shared/types'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const db = await getDb()

  const stmt = db.prepare(
    'SELECT id,title,source,folder,excerpt,filePath,analysis,segments,marks,videoMeta,videoSubtitles,subtitlePractice,readingPosition,createdAt FROM texts WHERE id=?'
  )
  stmt.bind([id])
  let row: any = null
  if (stmt.step()) row = stmt.getAsObject()
  stmt.free()
  if (!row) throw createError({ statusCode: 404, message: '视频不存在' })

  const source = row.source || ''
  const videoSources = ['youtube', 'bilibili', 'video_file', 'audio_file']
  if (!videoSources.includes(source)) {
    throw createError({ statusCode: 400, message: '该记录不是视频/音频类型' })
  }

  return {
    id: row.id,
    title: row.title || '未命名',
    source: row.source,
    folder: row.folder,
    excerpt: row.excerpt || '',
    filePath: row.filePath || '',
    createdAt: row.createdAt,
    videoMeta: safeParse<VideoMeta | null>(row.videoMeta, null),
    subtitles: safeParse<SubtitleCue[]>(row.videoSubtitles, []),
    practice: safeParse<Record<string, SubtitlePractice>>(row.subtitlePractice, {}),
    analysis: safeParse<any>(row.analysis, null),
    segments: safeParse<any[]>(row.segments, []),
    marks: safeParse<any[]>(row.marks, []),
    readingPosition: safeParse<{ paragraphId?: string; videoTime?: number } | null>(row.readingPosition, null),
  }
})
