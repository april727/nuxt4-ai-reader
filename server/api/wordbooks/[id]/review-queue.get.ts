import { queryAll, queryOne } from '../../../utils/db'

/**
 * 复习队列
 *
 * 顺序：学习阶段到期的 → 新词 → 复习到期的。
 * 之前前端一次性拉全部词（4400+），现在按到期时间 + 单次上限取卡。
 */
export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  if (!bookId) throw createError({ statusCode: 400, message: '缺少单词本' })

  const query = getQuery(event)
  const source = String(query.source || '')
  const type = String(query.type || '')
  const newLimit = Math.min(Math.max(Number(query.newLimit) || 20, 1), 100)
  const reviewLimit = Math.min(Math.max(Number(query.reviewLimit) || 40, 1), 200)
  const nowIso = new Date().toISOString()

  const conditions = ["phase<>'mastered'", "(dismissedAt IS NULL OR dismissedAt='')"]
  const args: any[] = []
  const isMixed = type === 'mixed' || bookId === 'mixed' || bookId === 'all'
  const bySource = Boolean(source && source !== '__orphan__')

  if (bySource) {
    // 按文章学习：只认来源与类型，不受词条被移动到哪个单词本影响
    conditions.push('source=?')
    args.push(source)
    if (type && type !== 'mixed') {
      conditions.push('type=?')
      args.push(type)
    }
  } else if (isMixed) {
    // 混合模式：跨三个默认本取卡
    conditions.push("bookId IN ('wb_default','wb_phrases','wb_sentences')")
  } else {
    conditions.push('bookId=?')
    args.push(bookId)
  }

  if (source === '__orphan__') {
    conditions.push("(source IS NULL OR source='')")
  }
  const base = conditions.join(' AND ')

  const dueLearn = await queryAll(
    `SELECT * FROM words WHERE ${base} AND phase='learn' AND nextReview<>'' AND nextReview<=? ORDER BY nextReview LIMIT ?`,
    [...args, nowIso, reviewLimit],
  )
  const fresh = await queryAll(
    `SELECT * FROM words WHERE ${base} AND phase='learn' AND (nextReview='' OR nextReview IS NULL) ORDER BY createdAt LIMIT ?`,
    [...args, newLimit],
  )
  const dueReview = await queryAll(
    `SELECT * FROM words WHERE ${base} AND phase='review' AND nextReview<>'' AND nextReview<=? ORDER BY nextReview LIMIT ?`,
    [...args, nowIso, reviewLimit],
  )

  const [cDueLearn, cFresh, cDueReview] = await Promise.all([
    queryOne(`SELECT COUNT(*) as c FROM words WHERE ${base} AND phase='learn' AND nextReview<>'' AND nextReview<=?`, [...args, nowIso]),
    queryOne(`SELECT COUNT(*) as c FROM words WHERE ${base} AND phase='learn' AND (nextReview='' OR nextReview IS NULL)`, args),
    queryOne(`SELECT COUNT(*) as c FROM words WHERE ${base} AND phase='review' AND nextReview<>'' AND nextReview<=?`, [...args, nowIso]),
  ])

  const cardType = type || (bookId === 'wb_phrases' ? 'phrase' : bookId === 'wb_sentences' ? 'sentence' : 'word')
  const TYPE_BY_BOOK: Record<string, string> = { wb_default: 'word', wb_phrases: 'phrase', wb_sentences: 'sentence' }
  const words = [...dueLearn, ...fresh, ...dueReview].map(w => ({
    ...w,
    cardType: isMixed ? (TYPE_BY_BOOK[w.bookId as string] || 'word') : cardType,
  }))

  const stats = {
    dueLearn: cDueLearn?.c || 0,
    newCount: cFresh?.c || 0,
    dueReview: cDueReview?.c || 0,
  }
  const available = stats.dueLearn + stats.newCount + stats.dueReview

  return {
    words,
    stats,
    available,
    hasMore: available > words.length,
    limits: { newLimit, reviewLimit },
  }
})
