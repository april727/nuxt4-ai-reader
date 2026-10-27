import { fetchImageBuffer } from '../../utils/net'
import { storeImage } from '../../utils/imageStore'

/**
 * 把用户选中的网络图片下载到自己的存储（R2 优先）。
 * 返回站内地址，避免外链失效、防盗链与混合内容问题。
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ url: string; textId?: string }>(event)
  if (!body?.url) throw createError({ statusCode: 400, message: '缺少图片地址' })

  const { data, contentType } = await fetchImageBuffer(body.url, { timeoutMs: 15_000, maxBytes: 10 * 1024 * 1024 })
  const stored = await storeImage(data, contentType, body.textId || 'default')

  return { url: stored.url, storage: stored.storage, bytes: stored.bytes }
})
