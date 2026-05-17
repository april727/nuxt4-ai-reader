import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  if (!name || name.includes('..')) {
    throw createError({ statusCode: 400, message: '无效的文件名' })
  }

  const filePath = path.resolve('server/data/uploads', name)
  if (!existsSync(filePath)) {
    throw createError({ statusCode: 404, message: '文件不存在' })
  }

  const ext = path.extname(name).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogg': 'audio/ogg',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.mov': 'video/quicktime',
  }

  const mimeType = mimeMap[ext] || 'application/octet-stream'
  const fileSize = statSync(filePath).size
  const rangeHeader = getHeader(event, 'range')

  setHeader(event, 'Accept-Ranges', 'bytes')
  setHeader(event, 'Content-Type', mimeType)

  if (rangeHeader) {
    // 解析 Range: "bytes=start-end"
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

    const chunkSize = end - start + 1
    setResponseStatus(event, 206)
    setHeader(event, 'Content-Range', `bytes ${start}-${end}/${fileSize}`)
    setHeader(event, 'Content-Length', chunkSize)

    return createReadStream(filePath, { start, end })
  }

  // 无 Range 请求（PDF 加载、视频首帧等），流式返回完整文件
  setHeader(event, 'Content-Length', fileSize)
  return createReadStream(filePath)
})
