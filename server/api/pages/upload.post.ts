import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

const DATA_ROOT = join(process.cwd(), 'server', 'data')
const FILES_ROOT = join(DATA_ROOT, 'files')

export default defineEventHandler(async (event) => {
  const body = await readBody<{ image: string }>(event)
  if (!body?.image) throw createError({ statusCode: 400 })

  // 解析 base64: data:image/png;base64,xxxxx
  const match = body.image.match(/^data:(image\/\w+);base64,(.+)$/)
  if (!match) throw createError({ statusCode: 400, message: '无效的图片格式' })

  const mimeType = match[1]
  const base64Data = match[2]
  const ext = mimeType.split('/')[1] === 'jpeg' ? 'jpg' : (mimeType.split('/')[1] || 'png')
  const name = `kp_img_${randomUUID().slice(0, 8)}.${ext}`

  const dir = join(FILES_ROOT, 'kp')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const filePath = join(dir, name)
  writeFileSync(filePath, Buffer.from(base64Data, 'base64'))

  return { url: `/api/file/kp/${encodeURIComponent(name)}` }
})
