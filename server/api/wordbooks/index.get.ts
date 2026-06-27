import { queryAll, queryOne } from '../../utils/db'

export default defineEventHandler(async () => {
  const rows = await queryAll('SELECT * FROM wordbooks ORDER BY isDefault DESC, sortOrder, createdAt')

  // 统计每个单词本的单词数
  for (const row of rows) {
    const cs = await queryOne('SELECT COUNT(*) as cnt FROM words WHERE bookId=?', [row.id])
    row.wordCount = cs?.cnt || 0

    // 待复习数
    const rs = await queryOne("SELECT COUNT(*) as cnt FROM words WHERE bookId=? AND phase='review' AND nextReview <= datetime('now')", [row.id])
    row.dueCount = rs?.cnt || 0
  }

  return rows
})
