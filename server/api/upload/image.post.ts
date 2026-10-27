import { storeImage } from '../../utils/imageStore'

/**
 * 通用图片上传：标记解释里的配图、段落插图都走这里。
 * R2 优先，失败回退本地；文件名用内容指纹，重复粘贴不会产生冗余文件。
 */
export default defineEventHandler(async (event) => {
  const t0 = Date.now()
  const form = await readMultipartFormData(event)
  const tRead = Date.now()
  if (!form?.length) throw createError({ statusCode: 400, message: '未收到文件' })

  const file = form.find(f => f.name === 'file')
  const textId = form.find(f => f.name === 'id')?.data.toString() || 'default'

  if (!file) throw createError({ statusCode: 400, message: '缺少文件' })

  const contentType = (file.type || '').startsWith('image/')
    ? file.type!
    : 'image/png'

  const stored = await storeImage(Buffer.from(file.data), contentType, textId)

  console.log(`[upload/image] 读取 ${tRead - t0}ms | 存储 ${Date.now() - tRead}ms | ${stored.storage} ${stored.bytes}B`)
  return { url: stored.url, storage: stored.storage, bytes: stored.bytes }
})
