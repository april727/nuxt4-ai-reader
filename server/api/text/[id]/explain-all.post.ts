import { startExplainTaskAsync } from '../../../utils/explainTask'

/**
 * POST /api/text/[id]/explain-all
 * 触发"解释全文"后台任务：立即返回，任务在服务端进程后台逐段生成。
 * 离开页面不影响，每段完成后写入 texts.explanations 缓存。
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400 })

  const result = await startExplainTaskAsync(id)
  if ('error' in result) {
    throw createError({ statusCode: 400, message: result.error })
  }

  // 保持后台执行（本地 dev 可靠）
  event.waitUntil(result.promise)

  return { total: result.total, pending: result.pending }
})
