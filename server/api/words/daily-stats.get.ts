import { queryAll } from '../../utils/db'

export default defineEventHandler(async () => {
  // 从 texts.marks 中按日期聚合统计
  const dailyMap = new Map<string, { word: number; phrase: number; sentence: number; total: number; texts: Set<string> }>()

  const rows = await queryAll(
    `SELECT id, marks FROM texts WHERE marks IS NOT NULL AND marks != '' AND marks != '[]'`
  )

  for (const row of rows) {
    let marks: any[] = []
    try { marks = JSON.parse(row.marks) } catch { continue }

    for (const m of marks) {
      if (!m.id || !m.createdAt) continue
      const date = (m.createdAt as string).slice(0, 10) // YYYY-MM-DD
      if (!dailyMap.has(date)) {
        dailyMap.set(date, { word: 0, phrase: 0, sentence: 0, total: 0, texts: new Set() })
      }
      const entry = dailyMap.get(date)!
      if (m.type === 'word') entry.word++
      else if (m.type === 'phrase') entry.phrase++
      else if (m.type === 'sentence') entry.sentence++
      entry.total++
      entry.texts.add(row.id as string)
    }
  }

  // 转为数组并按日期降序
  const days = Array.from(dailyMap.entries()).map(([date, data]) => ({
    date,
    word: data.word,
    phrase: data.phrase,
    sentence: data.sentence,
    total: data.total,
    textCount: data.texts.size,
  }))
  days.sort((a, b) => b.date.localeCompare(a.date))

  return { days }
})
