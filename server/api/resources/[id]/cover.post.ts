import { queryOne, runQuery } from '../../../utils/db'
import { storeImage } from '../../../utils/imageStore'

/**
 * 设置资源封面
 * - multipart：上传本地图片
 * - JSON { url }：把已有站内图片（如搜图后 import 的结果）设为封面
 */
export default defineEventHandler(async (event) => {
  const textId = getRouterParam(event, 'id')
  if (!textId) throw createError({ statusCode: 400, message: '缺少资源 id' })

  const exists = await queryOne('SELECT id FROM texts WHERE id=?', [textId])
  if (!exists) throw createError({ statusCode: 404, message: '资源不存在' })

  const contentType = getHeader(event, 'content-type') || ''
  let url = ''

  if (contentType.includes('multipart/form-data')) {
    const form = await readMultipartFormData(event)
    const file = form?.find(f => f.name === 'file')
    if (!file) throw createError({ statusCode: 400, message: '未收到文件' })
    const mime = (file.type || '').startsWith('image/') ? file.type! : 'image/png'
    const stored = await storeImage(Buffer.from(file.data), mime, textId)
    url = stored.url
  } else {
    const body = await readBody<{ url?: string }>(event)
    const input = String(body?.url || '')
    // 只接受站内文件地址，避免把任意外链写进数据库
    if (!input.startsWith('/api/file/')) throw createError({ statusCode: 400, message: '无效的封面地址' })
    url = input
  }

  await runQuery('UPDATE texts SET cover=?, updatedAt=? WHERE id=?', [url, new Date().toISOString(), textId])
  return { url }
})
