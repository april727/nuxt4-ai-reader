import { execSync, exec } from 'node:child_process'
import { existsSync, createWriteStream, readdirSync, statSync } from 'node:fs'
import { get } from 'node:https'
import { get as httpGet } from 'node:http'
import path from 'node:path'
import { queryOne, runQuery } from '../../../utils/db'
import { getThumbsDir, ensureDir, resolveFilePath } from '../../../utils/storage'
import type { VideoMeta } from '#shared/types'

function runCmd(cmd: string, timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024, timeout }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout.trim())
    })
  })
}

/** 下载 URL 图片到本地路径 */
function downloadImage(imageUrl: string, destPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!imageUrl.startsWith('http')) return resolve(false)
    const fetcher = imageUrl.startsWith('https') ? get : httpGet
    fetcher(imageUrl, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirect = res.headers.location
        if (redirect) return resolve(downloadImage(redirect, destPath))
        return resolve(false)
      }
      if (res.statusCode !== 200) return resolve(false)
      const file = createWriteStream(destPath)
      res.pipe(file)
      file.on('finish', () => resolve(true))
      file.on('error', () => resolve(false))
    }).on('error', () => resolve(false))
  })
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400 })

  const row = await queryOne('SELECT videoMeta,source,title,folder,filePath FROM texts WHERE id=?', [id])
  if (!row) throw createError({ statusCode: 404, message: '视频不存在' })

  let meta: VideoMeta
  try { meta = JSON.parse(row.videoMeta || '{}') } catch { meta = { url: '', type: 'video_file', duration: 0, thumbnail: '', originalFileName: '' } }

  const folderId = row.folder || 'default'
  const isOnline = ['youtube', 'bilibili'].includes(row.source)
  const isLocal = ['video_file', 'audio_file'].includes(row.source)

  let newThumbPath = ''

  // ── 在线视频：用 yt-dlp 获取缩略图 URL 并下载 ──
  if (isOnline && meta.url) {
    try {
      // 检查 yt-dlp
      execSync('yt-dlp --version', { encoding: 'utf-8', timeout: 5000 })

      const cookiesPath = path.resolve('server/data/youtube-cookies.txt')
      const cookieFlag = existsSync(cookiesPath) ? `--cookies "${cookiesPath}"` : ''

      const jsonStr = await runCmd(
        `yt-dlp --dump-json --no-warnings --ignore-no-formats-error ${cookieFlag} "${meta.url}"`,
        20000
      )
      const info = JSON.parse(jsonStr.split('\n')[0])
      const thumbUrl = info.thumbnail || ''

      if (thumbUrl) {
        const thumbDir = getThumbsDir(folderId, id)
        ensureDir(thumbDir)
        const ext = thumbUrl.match(/\.(jpg|jpeg|webp|png)(\?|$)/i)?.[1] || 'jpg'
        const destPath = path.join(thumbDir, `cover.${ext}`)
        const ok = await downloadImage(thumbUrl, destPath)
        if (ok) {
          newThumbPath = `${folderId}/${id}/thumbs/cover.${ext}`
        }
      }
    } catch (e: any) {
      console.warn(`[fix-thumbnail] ${id} 在线缩略图获取失败:`, e?.message)
    }
  }

  // ── 本地视频：用 ffmpeg 截取帧 ──
  if (isLocal && !newThumbPath) {
    // 多策略查找视频文件
    let videoFile = ''

    // 策略1: 从 DB filePath 解析（新旧格式兼容）
    const fp = row.filePath || ''
    if (fp) {
      const r = resolveFilePath(fp)
      if (existsSync(r)) videoFile = r
    }

    // 策略2: 在 uploads/ 中搜索匹配的视频文件
    if (!videoFile) {
      try {
        const uploadsDir = path.resolve('server/data/uploads')
        if (existsSync(uploadsDir)) {
          const files = readdirSync(uploadsDir)
          // 匹配 vid_{id片段}_ 或 vid_{timestamp}_ 开头的文件
          const match = files.find((f: string) =>
            f.startsWith(`vid_${id.replace('vid_', '')}`) ||
            (f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mov'))
          )
          if (match) videoFile = path.join(uploadsDir, match)
        }
      } catch {}
    }

    // 策略3: 在 files/ 中递归搜索
    if (!videoFile) {
      try {
        const filesDir = path.resolve('server/data/files')
        function find(dir: string): string | null {
          if (!existsSync(dir)) return null
          for (const entry of readdirSync(dir)) {
            const full = path.join(dir, entry)
            if (statSync(full).isDirectory()) {
              const found = find(full)
              if (found) return found
            } else if (entry === 'source.mp4' || entry === 'source.webm' || entry === 'source.mov') {
              // 检查父目录名是否匹配 contentId
              if (path.basename(path.dirname(full)) === id) return full
            }
          }
          return null
        }
        videoFile = find(filesDir) || ''
      } catch {}
    }

    if (!videoFile) {
      throw createError({ statusCode: 404, message: '未找到视频文件，文件可能已被移动或删除' })
    }

    // 用 ffmpeg 截取第 5 秒帧
    try {
      execSync('ffmpeg -version', { encoding: 'utf-8', timeout: 5000 })
      const thumbDir = getThumbsDir(folderId, id)
      ensureDir(thumbDir)
      const destPath = path.join(thumbDir, 'cover.jpg')

      execSync(
        `ffmpeg -ss 15 -i "${videoFile}" -vframes 1 -q:v 3 -y "${destPath}"`,
        { encoding: 'utf-8', timeout: 15000, stdio: 'pipe' }
      )

      if (existsSync(destPath)) {
        newThumbPath = `${folderId}/${id}/thumbs/cover.jpg`
      } else {
        throw createError({ statusCode: 500, message: 'ffmpeg 执行完成但未生成缩略图文件' })
      }
    } catch (e: any) {
      const msg = e?.statusCode ? e.message : 'ffmpeg 未安装或执行失败，请安装 ffmpeg 后重试'
      throw createError({ statusCode: e?.statusCode || 500, message: msg })
    }
  }

  // ── 更新 DB ──
  if (newThumbPath) {
    meta.thumbnail = newThumbPath
    await runQuery('UPDATE texts SET videoMeta=? WHERE id=?', [JSON.stringify(meta), id])
    return { ok: true, thumbnail: `/api/file/${newThumbPath}` }
  }

  throw createError({ statusCode: 500, message: '无法获取缩略图（需要 yt-dlp 或 ffmpeg）' })
})
