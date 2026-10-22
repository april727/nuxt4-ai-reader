import { queryVocab, queryString } from '../../../utils/vocabQuery'

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  if (!bookId) throw createError({ statusCode: 400 })

  const q = getQuery(event)
  return queryVocab({
    bookId,
    q: queryString(q.q),
    phase: queryString(q.phase) || 'all',
    pos: queryString(q.pos),
    page: Number(q.page) || 1,
    pageSize: Number(q.pageSize) || 50,
    sort: queryString(q.sort) || 'new',
  })
})
