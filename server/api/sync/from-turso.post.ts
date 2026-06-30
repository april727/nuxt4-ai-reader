import { syncFromTurso } from '../../utils/sync-from-turso'

export default defineEventHandler(async () => {
  try {
    const result = await syncFromTurso()
    return result
  } catch (e: any) {
    throw createError({ statusCode: 500, message: '拉取失败: ' + (e.message || '未知错误') })
  }
})
