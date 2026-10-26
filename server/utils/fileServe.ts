/**
 * 文件读取的统一出口（/api/file 与 /api/file/[...name] 共用）。
 *
 * 读取顺序：**本地优先 → R2 兜底**。
 *
 * 为什么不是 R2 优先（原来的实现）：
 * `storeImage` 本来就是「先写本地、再传 R2」，所以本地一定有一份；
 * R2 优先意味着每次看图都要多一次 HeadObject 往返，命中了还要 302 让浏览器
 * 跨境去 R2 拉图（1~3s/张）。本地读是毫秒级，跨国 R2 是它的 100 倍。
 *
 * 安全性：图片 key 是 `folder/textId/images/img_<sha256前16位>.<ext>`，内容寻址，
 * 同一 key 本地与 R2 内容必然一致，本地优先不会出现"读到旧图"。
 * 源文件（source.pdf）不是内容寻址，本地覆盖即最新，也只会更准。
 *
 * 本地不存在时（云部署换机、历史文件只在 R2）自动回落 R2，行为与原来一致。
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { createError, getHeader, setHeader, setResponseStatus, sendRedirect } from 'h3'
import type { H3Event } from 'h3'
import { resolveFilePath } from './storage'
import { useR2, r2Head, r2GetStream, r2SignedUrl } from './r2'

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mov': 'video/quicktime',
  '.vtt': 'text/vtt',
  '.srt': 'text/plain',
}

/** 需要 Range 的大媒体：本地走 206，R2 走流代理（不能 302，否则拖动进度条会重新连） */
const MEDIA_EXTS = new Set(['.mp4', '.webm', '.mov', '.ogg', '.mp3', '.wav', '.m4a'])
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg'])

function mimeOf(name: string) {
  return MIME[path.extname(name).toLowerCase()] || 'application/octet-stream'
}

export async function serveStoredFile(event: H3Event, name: string) {
  const ext = path.extname(name).toLowerCase()
  const mime = mimeOf(name)
  const isImage = IMAGE_EXTS.has(ext)

  // ── 1) 本地优先 ──
  const localPath = resolveFilePath(name)
  let size = 0
  try {
    size = existsSync(localPath) ? statSync(localPath).size : 0
  } catch {
    size = 0
  }
  if (size > 0) {
    setHeader(event, 'Accept-Ranges', 'bytes')
    setHeader(event, 'Content-Type', mime)
    // 图片按内容寻址，永远不变 → 让浏览器强缓存，二次打开直接读磁盘缓存（0 请求）
    setHeader(
      event,
      'Cache-Control',
      isImage ? 'private, max-age=31536000, immutable' : 'private, max-age=3600',
    )

    const rangeHeader = getHeader(event, 'range')
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
      if (!match) {
        setResponseStatus(event, 416)
        setHeader(event, 'Content-Range', `bytes */${size}`)
        return
      }
      const start = parseInt(match[1], 10)
      const end = match[2] ? parseInt(match[2], 10) : size - 1
      if (start >= size || end >= size) {
        setResponseStatus(event, 416)
        setHeader(event, 'Content-Range', `bytes */${size}`)
        return
      }
      setResponseStatus(event, 206)
      setHeader(event, 'Content-Range', `bytes ${start}-${end}/${size}`)
      setHeader(event, 'Content-Length', end - start + 1)
      return createReadStream(localPath, { start, end })
    }

    setHeader(event, 'Content-Length', size)
    return createReadStream(localPath)
  }

  // ── 2) R2 兜底 ──
  if (useR2()) {
    try {
      const head = await r2Head(name)
      if (head) {
        if (MEDIA_EXTS.has(ext)) {
          setHeader(event, 'Content-Type', mime)
          setHeader(event, 'Content-Length', head.ContentLength!)
          setHeader(event, 'Accept-Ranges', 'bytes')
          return r2GetStream(name)
        }
        const signedUrl = await r2SignedUrl(name, 3600)
        sendRedirect(event, signedUrl, 302)
        return
      }
    } catch (e: any) {
      console.warn(`[file] R2 不可达: ${name} (${e?.message || e})`)
    }
  }

  throw createError({ statusCode: 404, message: '文件不存在' })
}
