import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { resolveFilePath } from '../../utils/storage'
import { useR2, r2Head, r2GetStream, r2SignedUrl } from '../../utils/r2'

const mimeMap: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.mov': 'video/quicktime',
}

export default defineEventHandler(async (event) => {
  const rawName = getRouterParam(event, 'name')
  if (!rawName || rawName.includes('..')) {
    throw createError({ statusCode: 400, message: '无效的文件名' })
  }

  const name = decodeURIComponent(rawName)

  // ── R2 模式：生成签名 URL，302 跳转让浏览器直连 R2 ──
  if (useR2()) {
    const head = await r2Head(name)
    if (!head) throw createError({ statusCode: 404, message: '文件不存在' })

    const ext = path.extname(name).toLowerCase()
    if (['.mp4', '.webm', '.mov', '.ogg', '.mp3', '.wav', '.m4a'].includes(ext)) {
      setHeader(event, 'Content-Type', mimeMap[ext] || 'application/octet-stream')
      setHeader(event, 'Content-Length', head.ContentLength!)
      setHeader(event, 'Accept-Ranges', 'bytes')
      return r2GetStream(name)
    }

    const signedUrl = await r2SignedUrl(name, 3600)
    sendRedirect(event, signedUrl, 302)
    return
  }

  // ── 本地模式 ──
  const filePath = resolveFilePath(name)
  if (!existsSync(filePath)) throw createError({ statusCode: 404, message: '文件不存在' })

  const ext = path.extname(name).toLowerCase()
  const mimeType = mimeMap[ext] || 'application/octet-stream'
  const fileSize = statSync(filePath).size
  const rangeHeader = getHeader(event, 'range')

  setHeader(event, 'Accept-Ranges', 'bytes')
  setHeader(event, 'Content-Type', mimeType)

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
    if (!match) {
      setResponseStatus(event, 416)
      setHeader(event, 'Content-Range', `bytes */${fileSize}`)
      return
    }
    const start = parseInt(match[1], 10)
    const end = match[2] ? parseInt(match[2], 10) : fileSize - 1
    if (start >= fileSize || end >= fileSize) {
      setResponseStatus(event, 416)
      setHeader(event, 'Content-Range', `bytes */${fileSize}`)
      return
    }
    setResponseStatus(event, 206)
    setHeader(event, 'Content-Range', `bytes ${start}-${end}/${fileSize}`)
    setHeader(event, 'Content-Length', end - start + 1)
    return createReadStream(filePath, { start, end })
  }
  setHeader(event, 'Content-Length', fileSize)
  return createReadStream(filePath)
})
