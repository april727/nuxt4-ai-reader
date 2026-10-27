import { queryAll } from '../../utils/db'
import { getCached, setCache } from '../../utils/cache'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const folder = (query.folder as string) || 'default'

  const cacheKey = `texts:${folder}`
  const cached = getCached(cacheKey)
  if (cached) {
    return cached
  }

  async function getStats(): Promise<Map<string, any>> {
    const map = new Map()
    try {
      const stats = await queryAll('SELECT * FROM stats')
      for (const r of stats) map.set(r.textId, r)
    } catch {}
    return map
  }

  /** 按「文章 × 标记类型」聚合，供卡片显示词/短语/句子的分类数量（热态约 360ms） */
  async function getMarkTypes(): Promise<Map<string, { word: number; phrase: number; sentence: number }>> {
    const map = new Map<string, { word: number; phrase: number; sentence: number }>()
    try {
      const rows = await queryAll(
        'SELECT textId, type, COUNT(*) c FROM marks WHERE deletedAt IS NULL GROUP BY textId, type',
      )
      for (const r of rows) {
        const cur = map.get(r.textId) || { word: 0, phrase: 0, sentence: 0 }
        const t = String(r.type || 'word')
        if (t === 'word' || t === 'phrase' || t === 'sentence') cur[t] = Number(r.c) || 0
        map.set(r.textId, cur)
      }
    } catch {}
    return map
  }
  /**
   * 图片试卷没有正文，卡片需要「首页缩略图 + 页数」。
   * 只对 contentKind='sheet' 的行取 segments（试卷数量少），
   * 不能并进主查询——那会让 410 篇正文的 segments 全被读回，正是 COLS 刻意规避的。
   */
  async function getSheetInfo(): Promise<Map<string, { thumb: string; pages: number }>> {
    const map = new Map<string, { thumb: string; pages: number }>()
    try {
      const rows = await queryAll(
        "SELECT id, segments FROM texts WHERE contentKind='sheet' AND deletedAt IS NULL",
      )
      for (const r of rows) {
        try {
          const pages = JSON.parse(r.segments || '[]')
          if (!Array.isArray(pages) || !pages.length) continue
          map.set(r.id, { thumb: String(pages[0]?.url || ''), pages: pages.length })
        } catch {}
      }
    } catch {}
    return map
  }
  // 统计与标记聚合并行，避免串行叠加等待
  const [statsMap, markTypeMap, sheetMap] = await Promise.all([getStats(), getMarkTypes(), getSheetInfo()])

  let rows: any[]
  /**
   * 卡片所需的规模指标全部在 SQL 里算，且**不再取回 segments 正文**
   * （410 篇的 segments 合计约 3.6MB，取回要 6s+；只算不取约 0.8s）。
   *   词数 ≈ 空格数 + 1（英文为主，误差 <7%；图片 URL 不含空格，只算 1 个词）
   *   段落数 = segments JSON 里 `"id":` 的出现次数（每处 5 字符）
   *   aiSeg   = 是否含 AI 分段标记（原来的 includes('"id":"p-') 改由 SQL 判断）
   * 段落数随合并/重新分段变化，必须实时算，不能缓存进 stats。
   */
  const COLS = `id,title,source,folder,excerpt,createdAt,completedAt,filePath,videoMeta,nextReviewAt,reviewCount,reviewIntervalDays,contentKind,
    LENGTH(text) AS chars,
    (LENGTH(text) - LENGTH(REPLACE(text, ' ', '')) + 1) AS words,
    CASE WHEN segments IS NULL OR segments = '' THEN 0
         ELSE (LENGTH(segments) - LENGTH(REPLACE(segments, '"id":', ''))) / 5 END AS paraCount,
    CASE WHEN segments LIKE '%"id":"p-%' THEN 1 ELSE 0 END AS aiSeg`
  if (folder === 'review_today') {
    // 虚拟文件夹「今日复习」：不改动文章归属，按 nextReviewAt 到期筛选
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    rows = await queryAll(
      `SELECT ${COLS} FROM texts
       WHERE deletedAt IS NULL AND completedAt IS NOT NULL
         AND nextReviewAt IS NOT NULL AND nextReviewAt <= ?
       ORDER BY nextReviewAt ASC`,
      [today],
    )
  } else if (folder === 'all') {
    rows = await queryAll(`SELECT ${COLS} FROM texts WHERE deletedAt IS NULL ORDER BY createdAt DESC`)
  } else {
    rows = await queryAll(`SELECT ${COLS} FROM texts WHERE folder=? AND deletedAt IS NULL ORDER BY createdAt DESC`, [folder])
  }

  const result = rows.map((r: any) => {
    const s = statsMap.get(r.id) || {}
    let duration = 0
    let thumbnail = ''
    if (r.videoMeta) {
      try { const vm = JSON.parse(r.videoMeta); duration = vm.duration || 0; thumbnail = vm.thumbnail || '' } catch {}
    }
    if (thumbnail) {
      thumbnail = thumbnail.startsWith('http') ? thumbnail : `/api/file/${thumbnail}`
    }
    // 图片试卷：缩略图取第一页，页数取自 pages 数组（比 SQL 数 "id": 更准）
    const sheet = sheetMap.get(r.id)
    if (!thumbnail && sheet?.thumb) thumbnail = sheet.thumb
    const aiSegmented = Number(r.aiSeg) === 1
    return {
      id: r.id, title: r.title || '未命名', source: r.source || 'paste', folder: r.folder || r.folder,
      contentKind: r.contentKind || 'text',
      excerpt: r.excerpt || '', createdAt: r.createdAt, completedAt: r.completedAt || null,
      length: Number(r.chars) || 0,
      words: Number(r.words) || 0,
      paraCount: Number(r.paraCount) || 0,
      sheetPages: sheet?.pages || 0,
      readCount: s.readCount || 0, lastReadAt: s.lastReadAt || '', markCount: s.markCount || 0,
      nextReviewAt: r.nextReviewAt || null, reviewCount: Number(r.reviewCount) || 0,
      markTypes: markTypeMap.get(r.id) || { word: 0, phrase: 0, sentence: 0 },
      duration, thumbnail, aiSegmented,
    }
  })

  // 该查询要扫 410 篇正文与 1 万条标记，单次约 2~3.5s；默认 10s 缓存会导致频繁全量重算，
  // 故延长到 60s。增删改移动都会 clearCache()，新文章仍即时出现；
  // 只有「新增标记/阅读次数」这类轻量变化最多滞后 1 分钟。
  setCache(cacheKey, result, 60_000)
  return result
})
