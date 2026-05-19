import { batchProgress } from '../../utils/batch-state'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const batchId = query.batchId as string
  if (!batchId || !batchProgress.has(batchId)) {
    throw createError({ statusCode: 404, message: '批次不存在' })
  }
  return batchProgress.get(batchId)
})
