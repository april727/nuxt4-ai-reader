import { exec } from 'node:child_process'
import { existsSync, createWriteStream } from 'node:fs'
import { get } from 'node:https'
import { get as httpGet } from 'node:http'
import path from 'node:path'
import { runQuery } from '../../utils/db'
import { getThumbsDir, ensureDir } from '../../utils/storage'
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

function downloadThumbnailTo(
  imageUrl: string,
  folderId: string,
  contentId: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    if (!imageUrl || !imageUrl.startsWith('http')) return resolve(null)
    const extMatch = imageUrl.match(/\.(jpg|jpeg|webp|png)(\?|$)/i)
    const ext = extMatch?.[1] || 'jpg'
    const dir = getThumbsDir(folderId, contentId)
    ensureDir(dir)
    const filename = `cover.${ext}`
    const filePath = path.join(dir, filename)
    const relative = `${folderId}/${contentId}/thumbs/${filename}`

    if (existsSync(filePath)) return resolve(relative)

    const fetcher = imageUrl.startsWith('https') ? get : httpGet
    fetcher(imageUrl, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location
        if (redirectUrl) return resolve(downloadThumbnailTo(redirectUrl, folderId, contentId))
        return resolve(null)
      }
      if (res.statusCode !== 200) return resolve(null)
      const file = createWriteStream(filePath)
      res.pipe(file)
      file.on('finish', () => resolve(relative))
      file.on('error', () => resolve(null))
    }).on('error', () => resolve(null))
  })
}

/** 直接下载 YouTube 缩略图（不依赖 yt-dlp），尝试多个分辨率 */
async function tryDirectYouTubeThumbnail(videoId: string, folderId: string, contentId: string): Promise<string | null> {
  const qualities = ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault', 'default']
  for (const quality of qualities) {
    const url = `https://i.ytimg.com/vi/${videoId}/${quality}.jpg`
    try {
      const local = await downloadThumbnailTo(url, folderId, contentId)
      if (local) return local
    } catch { /* 静默继续尝试下一个分辨率 */ }
  }
  return null
}

function runCmd(cmd: string, timeout = 20000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr }))
      else resolve({ stdout, stderr })
    })
  })
}

/** 后台拉取元数据：标题、时长、封面（fallback：直接下载 → yt-dlp） */
async function fetchMetaInBackground(id: string, url: string, videoId: string, videoType: string, folderId: string, initialThumbnail: string) {
  try {
    // 先试直接 YouTube 封面下载（不依赖 yt-dlp，可能获取到更高分辨率）
    let localThumbnail = initialThumbnail
    if (!localThumbnail && videoType === 'youtube') {
      try {
        localThumbnail = await tryDirectYouTubeThumbnail(videoId, folderId, id) || ''
      } catch { /* 静默 */ }
    }

    // Fallback: yt-dlp 获取完整元数据
    let fetchedTitle = videoId
    let fetchedDuration = 0
    let fetchedThumbnail = ''

    try {
      await runCmd('yt-dlp --version', 5000)

      const cookiesPath = path.resolve('server/data/youtube-cookies.txt')
      const cookieFlag = existsSync(cookiesPath) ? `--cookies "${cookiesPath}"` : ''

      try {
        const result = await runCmd(
          `yt-dlp --dump-json --no-warnings --ignore-no-formats-error ${cookieFlag} "${url}"`,
          20000
        )
        const meta = JSON.parse(result.stdout.trim().split('\n')[0])
        fetchedTitle = meta.title || videoId
        fetchedDuration = meta.duration || 0
        fetchedThumbnail = meta.thumbnail || ''
      } catch { /* 静默 */ }

      // 下载 yt-dlp 返回的封面（可能比直接下载的分辨率更高）
      if (fetchedThumbnail) {
        try {
          const ytdlThumb = await downloadThumbnailTo(fetchedThumbnail, folderId, id)
          if (ytdlThumb) localThumbnail = ytdlThumb
        } catch { /* 保留已有封面 */ }
      }
    } catch { /* yt-dlp 不可用，保留已有封面 */ }

    // 更新 DB
    if (fetchedTitle !== videoId || fetchedDuration > 0) {
      const updatedMeta: VideoMeta = {
        url,
        type: videoType as VideoMeta['type'],
        duration: fetchedDuration,
        thumbnail: localThumbnail,
        originalFileName: '',
      }
      await runQuery(
        `UPDATE texts SET title=?, videoMeta=? WHERE id=?`,
        [fetchedTitle, JSON.stringify(updatedMeta), id]
      )
      console.log(`[quick-save] ${id} 元数据已更新: "${fetchedTitle}"`)
    }
  } catch {
    // 所有路径都失败，静默跳过；initialThumbnail 已在首次插入时写入
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ url: string; folder?: string }>(event)
  if (!body?.url?.trim()) throw createError({ statusCode: 400, message: '缺少 URL' })

  const url = body.url.trim()
  const videoId = extractVideoId(url)
  if (!videoId) throw createError({ statusCode: 400, message: '不支持的链接格式' })

  const isBilibili = url.includes('bilibili.com')
  const videoType = isBilibili ? 'bilibili' : 'youtube'
  const folderId = body.folder || 'default'

  const id = `vid_${Date.now()}`

  // YouTube：直接用固定 URL 规则下载封面，不依赖 yt-dlp
  let initialThumbnail = ''
  if (videoType === 'youtube') {
    try {
      initialThumbnail = await tryDirectYouTubeThumbnail(videoId, folderId, id) || ''
    } catch { /* 静默 */ }
  }

  const videoMeta: VideoMeta = {
    url,
    type: videoType,
    duration: 0,
    thumbnail: initialThumbnail,
    originalFileName: '',
  }

  await runQuery(
    `INSERT INTO texts (id,title,text,source,folder,excerpt,filePath,segments,analysis,videoMeta,videoSubtitles,createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, videoId, '', videoType, folderId,
      '', '', '[]', '', JSON.stringify(videoMeta), '[]', new Date().toISOString(),
    ]
  )

  // 后台异步拉取元数据（yt-dlp fallback：获取标题、时长、更高分辨率封面）
  fetchMetaInBackground(id, url, videoId, videoType, folderId, initialThumbnail)
    .catch(err => console.warn(`[quick-save] ${id} 元数据后台拉取失败:`, err.message))

  return { id, title: videoId }
})
