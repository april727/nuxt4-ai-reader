import { queryVocab, queryString } from '../../../../utils/vocabQuery'

export default defineEventHandler(async (event) => {
  const textId = getRouterParam(event, 'textId')
  if (!textId) throw createError({ statusCode: 400 })

  const q = getQuery(event)
  const type = queryString(q.type) || 'word'
  const bookIdMap: Record<string, string> = {
    word: 'wb_default',
    phrase: 'wb_phrases',
    sentence: 'wb_sentences',
  }
  if (!bookIdMap[type]) throw createError({ statusCode: 400, message: 'Invalid type' })

  // 按文章视图只看“来源 + 类型”，不看词现在归属哪个单词本，
  // 这样把词移到自定义本后，文章视图里仍然能找到它。
  return queryVocab({
    source: textId,
    type,
    q: queryString(q.q),
    phase: queryString(q.phase) || 'all',
    pos: queryString(q.pos),
    page: Number(q.page) || 1,
    pageSize: Number(q.pageSize) || 50,
    sort: queryString(q.sort) || 'new',
  })
})
