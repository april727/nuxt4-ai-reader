import { getExplainTask } from '../../../utils/explainTask'

/**
 * GET /api/text/[id]/explain-all-progress
 * 查询"解释全文"后台任务的进度。
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400 })

  const task = getExplainTask(id)
  return task || { textId: id, total: 0, done: 0, failed: 0, running: false, errors: [] }
})
