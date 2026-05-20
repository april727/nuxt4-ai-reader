import { writeFileSync, mkdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'

export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  if (!form?.[0]) throw createError({ statusCode: 400, message: '未收到文件' })

  const file = form[0]
  const ext = extname(file.filename || '.jpg') || '.jpg'
  const name = `thumb_${randomUUID().slice(0, 8)}${ext}`

  const dir = join(process.cwd(), 'server', 'data', 'uploads')
  mkdirSync(dir, { recursive: true })

  const filePath = join(dir, name)
  writeFileSync(filePath, file.data)

  return { url: `/api/file/${name}`, path: name, size: file.data?.length || 0 }
})
