import { queryAll, queryOne } from '../../utils/db'

export default defineEventHandler(async () => {
  // ── 从 marks 聚合数据（与复习本一致）──
  const markItems: Array<{ word: string; type: string; textId: string; pos: string }> = []

  // 预加载 words 表的 pos 索引
  const posIndex = new Map<string, string>()
  const posRows = await queryAll('SELECT LOWER(word) as w, pos FROM words WHERE pos IS NOT NULL AND pos != \'\'')
  for (const r of posRows) {
    if (!posIndex.has(r.w as string)) posIndex.set(r.w as string, r.pos as string)
  }

  // 预加载 text id → title
  const titleIndex = new Map<string, string>()
  const titleRows = await queryAll('SELECT id, title FROM texts')
  for (const r of titleRows) {
    titleIndex.set(r.id as string, r.title || '未命名')
  }

  const textsWithMarks = await queryAll(
    `SELECT id, marks FROM texts WHERE marks IS NOT NULL AND marks != '' AND marks != '[]'`
  )
  for (const row of textsWithMarks) {
    let marks: any[] = []
    try { marks = JSON.parse(row.marks) } catch { continue }
    for (const m of marks) {
      if (!m.id) continue
      const pos = posIndex.get((m.text || '').trim().toLowerCase()) || ''
      markItems.push({ word: m.text || '', type: m.type || 'word', textId: row.id as string, pos })
    }
  }

  // ── 概览（marks 来源）──
  const markWords = markItems.filter(m => m.type === 'word')
  const overview = {
    total: markItems.length,
    wordCount: markWords.length,
    phraseCount: markItems.filter(m => m.type === 'phrase').length,
    sentenceCount: markItems.filter(m => m.type === 'sentence').length,
  }

  // ── 词性分布（marks 来源，仅 word 类型）──
  const posMap = new Map<string, number>()
  for (const m of markWords) {
    const key = m.pos || '未标注'
    posMap.set(key, (posMap.get(key) || 0) + 1)
  }
  const posDistribution: Array<{ pos: string; count: number }> = []
  for (const [pos, count] of posMap) {
    posDistribution.push({ pos, count })
  }
  posDistribution.sort((a, b) => b.count - a.count)

  // ── 重复标记（marks 来源）──
  const wordCounts = new Map<string, { count: number; sources: Set<string> }>()
  for (const m of markWords) {
    const key = m.word.trim().toLowerCase()
    if (!wordCounts.has(key)) wordCounts.set(key, { count: 0, sources: new Set() })
    const entry = wordCounts.get(key)!
    entry.count++
    entry.sources.add(m.textId)
  }
  const dupRows: Array<{ word: string; count: number; sources: string[] }> = []
  for (const [word, data] of wordCounts) {
    if (data.count > 1) {
      dupRows.push({ word, count: data.count, sources: [...data.sources].slice(0, 5) })
    }
  }
  dupRows.sort((a, b) => b.count - a.count)
  const topDups = dupRows.slice(0, 30)

  // ── 来源文章统计（marks 来源）──
  const srcMap = new Map<string, number>()
  for (const m of markItems) {
    srcMap.set(m.textId, (srcMap.get(m.textId) || 0) + 1)
  }
  const topSources: Array<{ source: string; count: number; title: string }> = []
  for (const [textId, count] of srcMap) {
    topSources.push({ source: textId, count, title: titleIndex.get(textId) || '未命名' })
  }
  topSources.sort((a, b) => b.count - a.count)

  // ── 以下来自 words 表（SRS 相关）──
  const accuracyRow = await queryOne(`
    SELECT COUNT(*) as attempted,
      ROUND(AVG(CAST(learnCorrect AS REAL) / NULLIF(learnTotal, 0)) * 100, 1) as avgRate
    FROM words WHERE learnTotal > 0
  `)
  const accuracy = accuracyRow ? { attempted: accuracyRow.attempted as number, avgRate: accuracyRow.avgRate as number } : { attempted: 0, avgRate: 0 }

  const phaseRows = await queryAll('SELECT phase, COUNT(*) as count FROM words GROUP BY phase ORDER BY count DESC')

  const difficultRows = await queryAll(`
    SELECT id, word, phonetic, meaning, pos, phase,
      learnCorrect, learnTotal, learnWrong,
      ROUND(CAST(learnCorrect AS REAL) / NULLIF(learnTotal, 0) * 100, 1) as correctRate
    FROM words WHERE learnTotal >= 3
    ORDER BY CAST(learnCorrect AS REAL) / NULLIF(learnTotal, 0) ASC LIMIT 20
  `)

  const unlabeledRow = await queryOne(`
    SELECT COUNT(*) as cnt FROM words
    WHERE (pos IS NULL OR pos = '') AND bookId NOT IN ('wb_phrases', 'wb_sentences')
  `)
  const unlabeledCount = unlabeledRow ? (unlabeledRow.cnt as number) : 0

  const dupCountRows = await queryAll(`
    SELECT COUNT(*) as cnt FROM words GROUP BY bookId, LOWER(word) HAVING cnt > 1
  `)
  let phantomDups = 0
  for (const row of dupCountRows) {
    phantomDups += (row.cnt as number) - 1
  }

  return {
    overview,
    accuracy,
    posDistribution,
    phaseDistribution: phaseRows,
    duplicates: topDups,
    difficultWords: difficultRows,
    topSources: topSources.slice(0, 10),
    unlabeledCount,
    phantomDups,
  }
})
