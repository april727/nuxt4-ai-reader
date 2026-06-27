import { queryAll, queryOne } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const page = Math.max(1, parseInt(query.page as string) || 1)
  const pageSize = Math.min(100, Math.max(10, parseInt(query.pageSize as string) || 50))
  const filter = (query.filter as string) || 'all'       // all | learn | review | mastered
  const posFilter = (query.pos as string) || ''            // n. | v. | adj. | adv. | ...
  const sort = (query.sort as string) || 'recent'          // recent | difficult | alphabetical | source
  const bookId = (query.bookId as string) || ''            // 可选：按单词本筛选
  const search = (query.search as string) || ''            // 搜索词

  // 构建 WHERE 条件
  const conditions: string[] = []
  const params: any[] = []

  if (filter !== 'all') {
    conditions.push('w.phase = ?')
    params.push(filter)
  }
  if (posFilter) {
    conditions.push('w.pos = ?')
    params.push(posFilter)
  }
  if (bookId) {
    conditions.push('w.bookId = ?')
    params.push(bookId)
  }
  if (search) {
    conditions.push('(w.word LIKE ? OR w.meaning LIKE ?)')
    params.push(`%${search}%`, `%${search}%`)
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

  // 构建 ORDER BY
  let orderClause = 'ORDER BY w.createdAt DESC'
  if (sort === 'difficult') {
    orderClause = 'ORDER BY CASE WHEN w.learnTotal > 0 THEN CAST(w.learnCorrect AS REAL) / w.learnTotal ELSE 1 END ASC'
  } else if (sort === 'alphabetical') {
    orderClause = 'ORDER BY LOWER(w.word) ASC'
  } else if (sort === 'source') {
    orderClause = 'ORDER BY w.source, w.createdAt DESC'
  }

  // 总数
  const countRow = await queryOne(`SELECT COUNT(*) as total FROM words w ${whereClause}`, params)
  const total = countRow ? (countRow.total as number) : 0

  // 数据
  const offset = (page - 1) * pageSize
  const items = await queryAll(`
    SELECT w.*, t.title as sourceTitle
    FROM words w
    LEFT JOIN texts t ON w.source = t.id
    ${whereClause}
    ${orderClause}
    LIMIT ? OFFSET ?
  `, [...params, pageSize, offset])

  for (const item of items) {
    if (item.learnTotal > 0) {
      item.correctRate = Math.round((item.learnCorrect / item.learnTotal) * 100)
    } else {
      item.correctRate = null
    }
  }

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
})
