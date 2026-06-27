import { writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { getImagesDir, ensureDir } from '../../utils/storage'

export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  if (!form?.length) throw createError({ statusCode: 400, message: '未收到文件' })

  const file = form.find(f => f.name === 'file')
  const textId = form.find(f => f.name === 'id')?.data.toString() || 'default'

  if (!file) throw createError({ statusCode: 400, message: '缺少文件' })

  const ext = file.filename
    ? (file.filename.includes('.') ? '.' + file.filename.split('.').pop() : '.png')
    : '.png'
  const hash = randomUUID().slice(0, 8)
  const dir = getImagesDir('default', textId)
  ensureDir(dir)

  const filename = `img_${hash}${ext}`
  const filePath = `default/${textId}/images/${filename}`
  writeFileSync(dir + '/' + filename, file.data)

  return { url: `/api/file/${encodeURIComponent(filePath)}` }
})
