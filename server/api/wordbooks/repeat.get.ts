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
  // v2：docs 由「最多 3 篇」改为「全部来源 + 定位信息」，key 必须跟着变，
  // 否则旧缓存会让页面在 1 分钟内继续拿到没有 markId 的结构。
  const cacheKey = `repeat:v2:${min}:${limit}`
  const hit = getCached(cacheKey)
  if (hit) return hit

  const typeFilter = `m.type IN ('word','phrase','sentence')`

  /**
   * 计数口径（重要）：
   * 原始 marks 里存在大量「同毫秒重复写入」——同一篇、同一词、createdAt 精确到毫秒完全相同，
   * 实测 10,327 条里有 2,591 条属此类（占 25%，如 scrawny 在同一篇出现 6 条同毫秒记录），
   * 这是保存链路的重复写入，不是用户重复标记。若直接 COUNT(*) 会严重虚高，
   * 因此次数一律按 (文章 + 词 + 时间戳) 去重后再统计；原始条数另以 rawCount 返回供核对。
   */
  const agg = await queryAll(`
    WITH dedup AS (
      SELECT textId, type, createdAt, term FROM (
        SELECT textId, type, createdAt,
               LOWER(TRIM(COALESCE(NULLIF(lemma,''), text))) AS term
        FROM marks m
        WHERE m.deletedAt IS NULL AND ${typeFilter}
        GROUP BY textId, term, createdAt
      )
    )
    SELECT d.term,
           COUNT(*) AS n,
           COUNT(DISTINCT d.textId) AS docs,
           MAX(d.createdAt) AS lastAt,
           MAX(d.type) AS type,
           (SELECT COUNT(*) FROM marks m2
             WHERE m2.deletedAt IS NULL AND m2.type IN ('word','phrase','sentence')
               AND LOWER(TRIM(COALESCE(NULLIF(m2.lemma,''), m2.text))) = d.term) AS rawCount
    FROM dedup d
    GROUP BY d.term
    HAVING COUNT(*) >= ?
    ORDER BY n DESC, docs DESC, lastAt DESC
    LIMIT ?
  `, [min, limit])

  if (!agg.length) return { items: [] as any[], total: 0 }

  const terms = agg.map((r: any) => String(r.term))
  const placeholders = terms.map(() => '?').join(',')

  // 取展示信息与所属文章（来源全量返回，供页面逐条列出并跳转到词所在段落）
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
             m.textId,
             MAX(t.title) AS title,
             COUNT(DISTINCT m.createdAt) AS n,
             MIN(m.id) AS markId
      FROM marks m LEFT JOIN texts t ON t.id = m.textId
      WHERE m.deletedAt IS NULL AND ${typeFilter}
        AND LOWER(TRIM(COALESCE(NULLIF(m.lemma,''), m.text))) IN (${placeholders})
      GROUP BY term, m.textId
      ORDER BY n DESC, m.textId
    `, terms),
  ])

  /*
   * 定位信息：marks 表只有 textId，段落归属记在 texts.marks 这个 JSON 里。
   * 因此把涉及到的文章的 marks 单列出来解析，建一张 markId → paragraphId 的映射。
   * 只查 marks 列（不碰 segments，那是 200KB 级的大字段），几百篇合计几 MB，有 60s 缓存兜底。
   */
  const textIds = [...new Set(docRows.map((d: any) => String(d.textId)))]
  const pidByMark = new Map<string, string>()
  if (textIds.length) {
    const markBlobs = await queryAll(
      `SELECT id, marks FROM texts WHERE id IN (${textIds.map(() => '?').join(',')})`,
      textIds,
    )
    for (const r of markBlobs) {
      try {
        for (const m of JSON.parse(r.marks || '[]')) {
          if (m?.id && m.paragraphId) pidByMark.set(String(m.id), String(m.paragraphId))
        }
      } catch {}
    }
  }

  const wordMap = new Map<string, any>()
  for (const w of wordRows) if (!wordMap.has(w.term)) wordMap.set(w.term, w)

  const docMap = new Map<string, { textId: string; title: string; n: number; markId: string; paragraphId: string }[]>()
  for (const d of docRows) {
    const list = docMap.get(d.term) || []
    const markId = String(d.markId || '')
    list.push({
      textId: String(d.textId),
      title: d.title || '未命名',
      n: Number(d.n) || 1,
      markId,
      paragraphId: pidByMark.get(markId) || '',
    })
    docMap.set(d.term, list)
  }

  const items = agg.map((r: any) => {
    const w = wordMap.get(r.term) || {}
    return {
      term: r.term,
      type: r.type || 'word',
      markCount: Number(r.n),
      rawCount: Number(r.rawCount) || Number(r.n),
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
