import { queryAll, runQuery } from '../../utils/db'

export default defineEventHandler(async () => {
  // 查找所有重复词：同一 bookId 中 LOWER(word) 相同但 id 不同的条目
  const dupRows = await queryAll(`
    SELECT bookId, LOWER(word) as wordKey, COUNT(*) as cnt,
           GROUP_CONCAT(id) as ids
    FROM words
    GROUP BY bookId, LOWER(word)
    HAVING cnt > 1
  `)

  let removed = 0

  for (const row of dupRows) {
    const ids = (row.ids as string).split(',')
    // 保留第一条（最旧），删除其余
    const removeIds = ids.slice(1)

    for (const rid of removeIds) {
      await runQuery('DELETE FROM words WHERE id=?', [rid])
      removed++
    }
  }

  return { removed }
})
