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
       SUM(CASE WHEN phase='mastered' THEN 1 ELSE 0 END) as mastered,
       MAX(createdAt) as lastAt
     FROM words
     WHERE (dismissedAt IS NULL OR dismissedAt='') AND (archivedAt IS NULL OR archivedAt='')
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
    // 文章本排序用：最近有标记时间
    row.lastAt = c?.lastAt || ''
  }

  // 文章本随标记懒创建，字被删空后会留下空壳；这类空本不返回，避免列表被无内容分组刷屏
  return rows.filter((row) => {
    const isArticleBook = String(row.id).startsWith('wb_t_')
    return !isArticleBook || Number(row.wordCount) > 0
  })
})
