import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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

  const data = await readFile(filePath)
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

  setHeader(event, 'Content-Type', mimeMap[ext] || 'application/octet-stream')
  setHeader(event, 'Cache-Control', 'public, max-age=31536000')
  return data
})
