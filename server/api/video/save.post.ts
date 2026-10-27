import { queryAll, runQuery } from '../../utils/db'
import { subtitlesToText } from '../../utils/subtitle'
import { LEGACY_UPLOADS, moveToFinal, moveThumbToFinal } from '../../utils/storage'
import { existsSync } from 'node:fs'
import path from 'node:path'
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

  const plainText = body.text || (body.subtitles?.length ? subtitlesToText(body.subtitles) : body.title || '')
  const hasSubtitles = body.subtitles && body.subtitles.length > 0

  const title = body.title && body.title !== '未命名'
    ? body.title
    : (hasSubtitles ? body.subtitles![0].text.slice(0, 60) : '未命名视频')

  const id = `vid_${Date.now()}`
  const folderId = body.folder || 'default'

  // 去重
  if (hasSubtitles) {
    const fp = plainText.slice(0, 300).replace(/\s+/g, ' ').trim()
    const allRows = await queryAll('SELECT id,title,createdAt,text FROM texts')
    for (const row of allRows) {
      const f = String(row.text).slice(0, 300).replace(/\s+/g, ' ').trim()
      if (f === fp) {
        return { id: row.id, title: row.title, createdAt: row.createdAt, existed: true }
      }
    }
  }

  // 处理视频文件：从临时目录移动到最终位置
  let finalPath = body.filePath || ''
  if (finalPath && !finalPath.includes('/')) {
    const tempPath = path.join(LEGACY_UPLOADS, finalPath)
    if (existsSync(tempPath)) {
      finalPath = moveToFinal(tempPath, folderId, id, finalPath)
    }
  }

  // 处理缩略图：从临时目录移动到 thumbs/
  let finalThumb = body.thumbnail || ''
  if (finalThumb && !finalThumb.includes('/')) {
    const tempThumb = path.join(LEGACY_UPLOADS, finalThumb)
    if (existsSync(tempThumb)) {
      finalThumb = moveThumbToFinal(tempThumb, folderId, id)
    }
  }

  // 如果本地文件已移动到新位置，更新 URL
  const videoUrl = finalPath ? `/api/file/${finalPath}` : body.url

  const videoMeta: VideoMeta = {
    url: videoUrl,
    type: body.type,
    duration: body.duration || 0,
    thumbnail: finalThumb,
    originalFileName: body.filePath?.split('/').pop()?.split('\\').pop() || '',
  }

  const excerpt = hasSubtitles
    ? plainText.replace(/\s+/g, ' ').trim().slice(0, 150)
    : ''

  const segments = hasSubtitles
    ? body.subtitles!.map((c, idx) => ({
        id: `p-${idx}`,
        index: idx,
        text: c.text,
        start: c.start,
        end: c.end,
      }))
    : []

  const createdAt = new Date().toISOString()

  await runQuery(
    `INSERT INTO texts (id,title,text,source,folder,excerpt,filePath,segments,analysis,videoMeta,videoSubtitles,createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, title, hasSubtitles ? plainText.slice(0, 100000) : '', body.type, folderId,
      excerpt, finalPath, JSON.stringify(segments), '',
      JSON.stringify(videoMeta), JSON.stringify(body.subtitles || []), createdAt,
    ]
  )

  return { id, title, createdAt }
})
