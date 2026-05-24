import { queryAll } from '../../utils/db'

export default defineEventHandler(async () => {
  const rows = await queryAll(`
    SELECT t.id, t.title,
      COUNT(*) as totalCount,
      SUM(CASE WHEN w.bookId = 'wb_default' THEN 1 ELSE 0 END) as wordCount,
      SUM(CASE WHEN w.bookId = 'wb_phrases' THEN 1 ELSE 0 END) as phraseCount,
      SUM(CASE WHEN w.bookId = 'wb_sentences' THEN 1 ELSE 0 END) as sentenceCount,
      SUM(CASE WHEN w.phase = 'review' AND w.nextReview <= datetime('now') THEN 1 ELSE 0 END) as dueCount
    FROM texts t
    INNER JOIN words w ON w.source = t.id
    GROUP BY t.id
    ORDER BY MAX(w.createdAt) DESC
  `)

  // 统计未归类（source 为空）的单词
  const orphans = await queryAll(`
    SELECT
      COUNT(*) as totalCount,
      SUM(CASE WHEN w.bookId = 'wb_default' THEN 1 ELSE 0 END) as wordCount,
      SUM(CASE WHEN w.bookId = 'wb_phrases' THEN 1 ELSE 0 END) as phraseCount,
      SUM(CASE WHEN w.bookId = 'wb_sentences' THEN 1 ELSE 0 END) as sentenceCount,
      SUM(CASE WHEN w.phase = 'review' AND w.nextReview <= datetime('now') THEN 1 ELSE 0 END) as dueCount
    FROM words w
    WHERE w.source IS NULL OR w.source = ''
  `)

  if (orphans.length && orphans[0].totalCount > 0) {
    rows.push({
      id: '__orphan__',
      title: '其他',
      ...orphans[0],
    })
  }

  return rows
})
