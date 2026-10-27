import { segmentInProgress } from './segment-async.post'

export default defineEventHandler(async (event) => {
  const id = getQuery(event).id as string
  if (!id) throw createError({ statusCode: 400, message: '缺少 id' })

  return {
    running: segmentInProgress.has(id),
  }
})
