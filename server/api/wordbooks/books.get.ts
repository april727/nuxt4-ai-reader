import { queryAll } from '../../utils/db'

/**
 * 资源档案视图：按文章聚合
 *
 * texts 本身就是资源档案，这里补上阅读统计（stats）与「来源已删除」的词条，
 * 让资源列表能回答：这篇文章标记了多少词、学了多久、还剩多少。
 */
export default defineEventHandler(async () => {
  const nowIso = new Date().toISOString()

  const rows = await queryAll(`
    SELECT t.id, t.title, t.folder, t.createdAt, t.cover,
      COALESCE(s.readCount, 0) as readCount,
      s.lastReadAt,
      COUNT(w.id) as totalCount,
      SUM(CASE WHEN w.bookId = 'wb_default' THEN 1 ELSE 0 END) as wordCount,
      SUM(CASE WHEN w.bookId = 'wb_phrases' THEN 1 ELSE 0 END) as phraseCount,
      SUM(CASE WHEN w.bookId = 'wb_sentences' THEN 1 ELSE 0 END) as sentenceCount,
      SUM(CASE WHEN w.phase = 'mastered' THEN 1 ELSE 0 END) as masteredCount,
      SUM(CASE WHEN w.phase <> 'mastered' AND w.nextReview <> '' AND w.nextReview <= ? THEN 1 ELSE 0 END) as dueCount,
      MAX(w.createdAt) as lastMarkedAt
    FROM texts t
    INNER JOIN words w ON w.source = t.id
      AND (w.dismissedAt IS NULL OR w.dismissedAt = '')
      AND (w.archivedAt IS NULL OR w.archivedAt = '')
    LEFT JOIN stats s ON s.textId = t.id
    WHERE t.deletedAt IS NULL
    GROUP BY t.id
    ORDER BY dueCount DESC, lastMarkedAt DESC
  `, [nowIso])

  // 未归类（source 为空）的词
  const orphans = await queryAll(`
    SELECT
      COUNT(*) as totalCount,
      SUM(CASE WHEN w.bookId = 'wb_default' THEN 1 ELSE 0 END) as wordCount,
      SUM(CASE WHEN w.bookId = 'wb_phrases' THEN 1 ELSE 0 END) as phraseCount,
      SUM(CASE WHEN w.bookId = 'wb_sentences' THEN 1 ELSE 0 END) as sentenceCount,
      SUM(CASE WHEN w.phase = 'mastered' THEN 1 ELSE 0 END) as masteredCount,
      SUM(CASE WHEN w.phase <> 'mastered' AND w.nextReview <> '' AND w.nextReview <= ? THEN 1 ELSE 0 END) as dueCount,
      MAX(w.createdAt) as lastMarkedAt
    FROM words w
    WHERE (w.source IS NULL OR w.source = '') AND (w.dismissedAt IS NULL OR w.dismissedAt = '')
      AND (w.archivedAt IS NULL OR w.archivedAt = '')
  `, [nowIso])

  if (orphans.length && Number(orphans[0].totalCount) > 0) {
    rows.push({ id: '__orphan__', title: '其他', ...orphans[0] })
  }

  // 来源已被删除 / 找不到文章的词条：仍可学习，但不再属于任何资源
  const detached = await queryAll(`
    SELECT COUNT(*) as totalCount,
      SUM(CASE WHEN w.phase = 'mastered' THEN 1 ELSE 0 END) as masteredCount,
      SUM(CASE WHEN w.phase <> 'mastered' AND w.nextReview <> '' AND w.nextReview <= ? THEN 1 ELSE 0 END) as dueCount,
      MAX(w.createdAt) as lastMarkedAt
    FROM words w
    LEFT JOIN texts t ON t.id = w.source
    WHERE w.source <> '' AND (t.id IS NULL OR t.deletedAt IS NOT NULL)
      AND (w.dismissedAt IS NULL OR w.dismissedAt = '')
      AND (w.archivedAt IS NULL OR w.archivedAt = '')
  `, [nowIso])

  if (detached.length && Number(detached[0].totalCount) > 0) {
    rows.push({ id: '__detached__', title: '来源已删除', detached: 1, ...detached[0] })
  }

  return rows
})
