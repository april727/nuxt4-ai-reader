import { getDb, saveDb } from '../../utils/db'
import { subtitlesToText } from '../../utils/subtitle'
import type { SubtitleCue, VideoMeta } from '#shared/types'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    title?: string
    url: string
    type: 'youtube' | 'bilibili' | 'video_file' | 'audio_file'
    subtitles: SubtitleCue[]
    duration?: number
    folder?: string
    filePath?: string
    thumbnail?: string
    text?: string
  }>(event)

  if (!body?.url) throw createError({ statusCode: 400, message: '缺少视频 URL' })

  // 拼接字幕纯文本（空字幕时用标题占位）
  const plainText = body.text || (body.subtitles?.length ? subtitlesToText(body.subtitles) : body.title || '')
  const hasSubtitles = body.subtitles && body.subtitles.length > 0

  // 自动生成标题
  const title = body.title && body.title !== '未命名'
    ? body.title
    : (hasSubtitles ? body.subtitles![0].text.slice(0, 60) : '未命名视频')

  const id = `vid_${Date.now()}`
  const db = await getDb()

  // 有字幕才去重
  if (hasSubtitles) {
    const fp = plainText.slice(0, 300).replace(/\s+/g, ' ').trim()
    const stmt = db.prepare('SELECT id,title,createdAt FROM texts')
    while (stmt.step()) {
      const row = stmt.getAsObject()
      const f = String(row.text).slice(0, 300).replace(/\s+/g, ' ').trim()
      if (f === fp) {
        stmt.free()
        return { id: row.id, title: row.title, createdAt: row.createdAt, existed: true }
      }
    }
    stmt.free()
  }

  const videoMeta: VideoMeta = {
    url: body.url,
    type: body.type,
    duration: body.duration || 0,
    thumbnail: body.thumbnail || '',
    originalFileName: body.filePath?.split('/').pop() || '',
  }

  const excerpt = hasSubtitles
    ? plainText.replace(/\s+/g, ' ').trim().slice(0, 150)
    : ''
  const createdAt = new Date().toISOString()

  // 有字幕时自动分段
  const segments = hasSubtitles
    ? body.subtitles!.map((c, idx) => ({
        id: `p-${idx}`,
        index: idx,
        text: c.text,
        start: c.start,
        end: c.end,
      }))
    : []

  db.run(
    `INSERT INTO texts (id,title,text,source,folder,excerpt,filePath,segments,analysis,videoMeta,videoSubtitles,createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      title,
      hasSubtitles ? plainText.slice(0, 100000) : '',
      body.type,
      body.folder || 'default',
      excerpt,
      body.filePath || '',
      JSON.stringify(segments),
      '',
      JSON.stringify(videoMeta),
      JSON.stringify(body.subtitles || []),
      createdAt,
    ]
  )

  await saveDb()

  return { id, title, createdAt }
})
