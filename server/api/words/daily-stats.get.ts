import { queryAll } from '../../utils/db'

export default defineEventHandler(async () => {
  // 从 marks 表按日期 + 类型聚合统计
  const rows = await queryAll(
    `SELECT date(createdAt) as d, type,
            COUNT(*) as cnt,
            COUNT(DISTINCT textId) as textCnt
     FROM marks
     GROUP BY date(createdAt), type
     ORDER BY d DESC`
  )

  // 合并同一天的 word/phrase/sentence 统计
  const dayMap = new Map<string, { word: number; phrase: number; sentence: number; total: number; textCount: number }>()
  for (const row of rows) {
    const d = row.d as string
    const type = row.type as string
    const cnt = Number(row.cnt)
    const tc = Number(row.textCnt)

    if (!dayMap.has(d)) {
      dayMap.set(d, { word: 0, phrase: 0, sentence: 0, total: 0, textCount: 0 })
    }
    const entry = dayMap.get(d)!
    if (type === 'word') entry.word += cnt
    else if (type === 'phrase') entry.phrase += cnt
    else if (type === 'sentence') entry.sentence += cnt
    entry.total += cnt
    // textCount 取当天各类型中最大的（同一天跨文章写作）
    if (tc > entry.textCount) entry.textCount = tc
  }

  const days = Array.from(dayMap.entries()).map(([date, data]) => ({
    date,
    ...data,
  }))

  return { days }
})
