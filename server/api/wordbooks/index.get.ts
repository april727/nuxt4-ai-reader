import { queryAll, queryOne } from '../../utils/db'

export default defineEventHandler(async () => {
  const rows = await queryAll('SELECT * FROM wordbooks ORDER BY isDefault DESC, sortOrder, createdAt')
  const nowIso = new Date().toISOString()

  // 统计每个单词本的数量（一次查出，避免每个本两次往返）
  const counts = await queryAll(
    `SELECT bookId,
       COUNT(*) as total,
       SUM(CASE WHEN phase<>'mastered' AND nextReview<>'' AND nextReview<=? THEN 1 ELSE 0 END) as due,
       SUM(CASE WHEN phase='learn' AND (nextReview='' OR nextReview IS NULL) THEN 1 ELSE 0 END) as fresh,
       SUM(CASE WHEN phase='mastered' THEN 1 ELSE 0 END) as mastered
     FROM words
     WHERE (dismissedAt IS NULL OR dismissedAt='')
     GROUP BY bookId`,
    [nowIso],
  )
  const byBook = new Map(counts.map(c => [c.bookId as string, c]))

  for (const row of rows) {
    const c = byBook.get(row.id as string)
    row.wordCount = Number(c?.total || 0)
    row.dueCount = Number(c?.due || 0)
    row.newCount = Number(c?.fresh || 0)
    row.masteredCount = Number(c?.mastered || 0)
  }

  return rows
})
