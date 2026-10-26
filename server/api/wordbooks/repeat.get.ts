/**
 * 重复标记词表（重点攻克页数据源）
 *
 * 口径（用户确认）：
 *  - 「重复次数」= 该词被标记的总次数，**同一篇文章内重复标记也计入**
 *  - 「涉及文章数」= 在不同文章中被标记的篇数，用于判断是"单篇难"还是"普遍没掌握"
 *  - 词形归一：有 lemma 用 lemma，否则用原文，统一小写聚合
 *  - note 类型不计入（它不进单词本）
 *
 * 数据不落库、实时从 marks 聚合 —— marks 是唯一事实来源，避免计数漂移。
 * 单词本侧只取一条展示用的释义/音标（同一词可能同时存在于文章本与默认本）。
 */
import { queryAll } from '../../utils/db'
import { getCached, setCache } from '../../utils/cache'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const min = Math.max(2, Number(q.min) || 2)
  const limit = Math.min(500, Number(q.limit) || 100)
  // 聚合要扫 1 万条标记（冷 3s / 热 0.8s），做 60s 缓存；标记变动最多滞后 1 分钟
  const cacheKey = `repeat:${min}:${limit}`
  const hit = getCached(cacheKey)
  if (hit) return hit

  const typeFilter = `m.type IN ('word','phrase','sentence')`

  const agg = await queryAll(`
    SELECT LOWER(TRIM(COALESCE(NULLIF(m.lemma,''), m.text))) AS term,
           COUNT(*) AS n,
           COUNT(DISTINCT m.textId) AS docs,
           MAX(m.createdAt) AS lastAt,
           MAX(m.type) AS type
    FROM marks m
    WHERE m.deletedAt IS NULL AND ${typeFilter}
    GROUP BY term
    HAVING COUNT(*) >= ?
    ORDER BY n DESC, lastAt DESC
    LIMIT ?
  `, [min, limit])

  if (!agg.length) return { items: [] as any[], total: 0 }

  const terms = agg.map((r: any) => String(r.term))
  const placeholders = terms.map(() => '?').join(',')

  // 取展示信息与所属文章（每词最多 3 篇，供页面跳转）
  const [wordRows, docRows] = await Promise.all([
    queryAll(`
      SELECT LOWER(word) AS term, id, phonetic, meaning, pos, bookId
      FROM words
      WHERE LOWER(word) IN (${placeholders})
        AND bookId IN ('wb_default','wb_phrases','wb_sentences')
      ORDER BY CASE WHEN phonetic<>'' OR meaning<>'' THEN 0 ELSE 1 END
    `, terms),
    queryAll(`
      SELECT LOWER(TRIM(COALESCE(NULLIF(m.lemma,''), m.text))) AS term,
             m.textId, MAX(t.title) AS title, COUNT(*) AS n
      FROM marks m LEFT JOIN texts t ON t.id = m.textId
      WHERE m.deletedAt IS NULL AND ${typeFilter}
        AND LOWER(TRIM(COALESCE(NULLIF(m.lemma,''), m.text))) IN (${placeholders})
      GROUP BY term, m.textId
      ORDER BY n DESC
    `, terms),
  ])

  const wordMap = new Map<string, any>()
  for (const w of wordRows) if (!wordMap.has(w.term)) wordMap.set(w.term, w)

  const docMap = new Map<string, { textId: string; title: string; n: number }[]>()
  for (const d of docRows) {
    const list = docMap.get(d.term) || []
    if (list.length < 3) list.push({ textId: d.textId, title: d.title || '未命名', n: Number(d.n) })
    docMap.set(d.term, list)
  }

  const items = agg.map((r: any) => {
    const w = wordMap.get(r.term) || {}
    return {
      term: r.term,
      type: r.type || 'word',
      markCount: Number(r.n),
      docCount: Number(r.docs),
      lastAt: r.lastAt,
      wordId: w.id || '',
      phonetic: w.phonetic || '',
      meaning: w.meaning || '',
      pos: w.pos || '',
      docs: docMap.get(r.term) || [],
    }
  })

  const payload = { items, total: items.length, min }
  setCache(cacheKey, payload, 60_000)
  return payload
})
