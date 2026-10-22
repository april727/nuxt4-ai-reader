/**
 * 词汇列表查询（分页 + 搜索 + 筛选）
 *
 * 之前列表接口一次性返回整本词（4400+），无搜索、无分页；
 * 词性统计还要扫全部 texts.marks JSON。这里统一走 words 表做 SQL 过滤与聚合。
 */
import { queryAll, queryOne } from './db'

export interface VocabQuery {
  bookId?: string
  bookIds?: string[]
  /** 文章 id；'__orphan__' 表示无来源的散词 */
  source?: string
  q?: string
  phase?: string
  pos?: string
  /** 词条类型：word / phrase / sentence（移动单词本后仍然保留） */
  type?: string
  page?: number
  pageSize?: number
  sort?: string
}

function buildWhere(o: VocabQuery, includePos = true): { sql: string; args: any[] } {
  const where: string[] = ["(dismissedAt IS NULL OR dismissedAt='')"]
  const args: any[] = []

  if (o.bookIds?.length) {
    where.push(`bookId IN (${o.bookIds.map(() => '?').join(',')})`)
    args.push(...o.bookIds)
  } else if (o.bookId) {
    where.push('bookId=?')
    args.push(o.bookId)
  }

  if (o.source === '__orphan__') {
    where.push("(source IS NULL OR source='')")
  } else if (o.source) {
    where.push('source=?')
    args.push(o.source)
  }

  if (o.q) {
    const like = `%${o.q.toLowerCase()}%`
    where.push('(LOWER(word) LIKE ? OR LOWER(meaning) LIKE ?)')
    args.push(like, like)
  }

  if (o.phase && o.phase !== 'all') {
    where.push('phase=?')
    args.push(o.phase)
  }

  if (o.type && o.type !== 'all') {
    where.push('type=?')
    args.push(o.type)
  }

  if (includePos && o.pos) {
    if (o.pos === '未标注') where.push("(pos IS NULL OR pos='')")
    else { where.push('pos=?'); args.push(o.pos) }
  }

  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args }
}

export async function queryVocab(o: VocabQuery) {
  const page = Math.max(1, Number(o.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(o.pageSize) || 50))
  const offset = (page - 1) * pageSize

  const filtered = buildWhere(o)
  const unfilteredByPos = buildWhere(o, false)

  const sortSql = o.sort === 'alpha'
    ? 'ORDER BY LOWER(word) ASC'
    : o.sort === 'due'
      ? "ORDER BY CASE WHEN nextReview='' THEN 1 ELSE 0 END ASC, nextReview ASC"
      : 'ORDER BY createdAt DESC'

  const [totalRow, words, posRows, phaseRows] = await Promise.all([
    queryOne(`SELECT COUNT(*) as c FROM words ${filtered.sql}`, filtered.args),
    queryAll(`SELECT * FROM words ${filtered.sql} ${sortSql} LIMIT ? OFFSET ?`, [...filtered.args, pageSize, offset]),
    queryAll(
      `SELECT COALESCE(NULLIF(pos,''),'未标注') as k, COUNT(*) as c FROM words ${unfilteredByPos.sql} GROUP BY k`,
      unfilteredByPos.args,
    ),
    queryAll(
      `SELECT phase as k, COUNT(*) as c FROM words ${unfilteredByPos.sql} GROUP BY phase`,
      unfilteredByPos.args,
    ),
  ])

  const total = Number(totalRow?.c || 0)

  return {
    words,
    total,
    page,
    pageSize,
    hasMore: offset + words.length < total,
    posCounts: Object.fromEntries(posRows.map((r: any) => [r.k, Number(r.c)])),
    phaseCounts: Object.fromEntries(phaseRows.map((r: any) => [r.k, Number(r.c)])),
  }
}

export function queryString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}
