import { queryOne } from '../../../../utils/db'
import { buildComposedCard } from '../../../../utils/cardCompose'

/**
 * 卡片基础数据（纯本地组合，不调用模型）。
 * 用于翻面之前就拿到：标记解析章节、所在句、配图、已有词根/近义词缓存。
 * 是否还需要 AI 补全，由返回的 needsAI / missing 决定。
 */
export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  const query = getQuery(event)
  const wordId = String(query.wordId || '')
  if (!bookId || !wordId) throw createError({ statusCode: 400, message: '缺少 wordId' })

  const word = await queryOne('SELECT * FROM words WHERE id=? AND bookId=?', [wordId, bookId])
  if (!word) throw createError({ statusCode: 404, message: '词条不存在' })

  const type = (query.type as 'word' | 'phrase' | 'sentence')
    || (bookId === 'wb_phrases' ? 'phrase' : bookId === 'wb_sentences' ? 'sentence' : 'word')

  return { ...buildComposedCard(word, type), llm: false }
})
