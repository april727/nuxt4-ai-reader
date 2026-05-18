import { getDb, saveDb } from '../../utils/db'
import type { VideoMeta } from '#shared/types'

/** 从 YouTube/Bilibili URL 提取视频 ID */
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:bilibili\.com\/video\/)(BV[a-zA-Z0-9]+)/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m) return m[1]
  }
  return null
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ url: string; folder?: string }>(event)
  if (!body?.url?.trim()) throw createError({ statusCode: 400, message: '缺少 URL' })

  const url = body.url.trim()
  const videoId = extractVideoId(url)
  if (!videoId) throw createError({ statusCode: 400, message: '不支持的链接格式' })

  // 检测平台
  const isBilibili = url.includes('bilibili.com')
  const videoType = isBilibili ? 'bilibili' : 'youtube'

  // 用视频 ID 做临时标题
  const id = `vid_${Date.now()}`

  const videoMeta: VideoMeta = {
    url,
    type: videoType,
    duration: 0,
    thumbnail: '',
    originalFileName: '',
  }

  const db = await getDb()
  db.run(
    `INSERT INTO texts (id,title,text,source,folder,excerpt,filePath,segments,analysis,videoMeta,videoSubtitles,createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      videoId,
      '',
      videoType,
      body.folder || 'default',
      '',
      '',
      '[]',
      '',
      JSON.stringify(videoMeta),
      '[]',
      new Date().toISOString(),
    ]
  )
  await saveDb()

  return { id, title: videoId }
})
