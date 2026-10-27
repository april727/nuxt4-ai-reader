import { serveStoredFile } from '../../utils/fileServe'

export default defineEventHandler(async (event) => {
  const rawName = getRouterParam(event, 'name')
  if (!rawName || rawName.includes('..')) {
    throw createError({ statusCode: 400, message: '无效的文件名' })
  }
  return serveStoredFile(event, decodeURIComponent(rawName))
})
