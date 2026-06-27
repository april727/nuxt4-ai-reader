import { syncToTurso } from '../../utils/sync-turso'

export default defineEventHandler(async () => {
  try {
    const result = await syncToTurso()
    return result
  } catch (e: any) {
    throw createError({ statusCode: 500, message: '同步失败: ' + (e.message || '未知错误') })
  }
})
