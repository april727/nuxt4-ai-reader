import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ALLOWED_VIDEO = ['.mp4', '.webm', '.ogg', '.mp3', '.wav', '.m4a', '.mov']

export default defineEventHandler(async (event) => {
  const formData = await readFormData(event)
  const file = formData.get('file') as File | null
  if (!file) throw createError({ statusCode: 400, message: '请选择视频/音频文件' })

  const ext = path.extname(file.name).toLowerCase()
  if (!ALLOWED_VIDEO.includes(ext)) {
    throw createError({ statusCode: 400, message: `不支持的文件格式 ${ext}，支持: ${ALLOWED_VIDEO.join(', ')}` })
  }

  // 限制 200MB
  const MAX_SIZE = 200 * 1024 * 1024
  if (file.size > MAX_SIZE) {
    throw createError({ statusCode: 400, message: '文件过大，限制 200MB' })
  }

  const uploadDir = path.resolve('server/data/uploads/videos')
  if (!existsSync(uploadDir)) {
    await mkdir(uploadDir, { recursive: true })
  }

  // 时间戳 + 随机后缀防重名
  const timestamp = Date.now()
  const safeName = `${timestamp}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const filePath = path.join(uploadDir, safeName)

  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(filePath, buffer)

  return {
    filePath: `videos/${safeName}`,
    url: `/api/file/videos/${safeName}`,
    originalName: file.name,
    size: file.size,
  }
})
