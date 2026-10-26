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
  const statsMap = await getStats()

  let rows: any[]
  /**
   * 卡片所需的规模指标全部在 SQL 里算，且**不再取回 segments 正文**
   * （410 篇的 segments 合计约 3.6MB，取回要 6s+；只算不取约 0.8s）。
   *   词数 ≈ 空格数 + 1（英文为主，误差 <7%；图片 URL 不含空格，只算 1 个词）
   *   段落数 = segments JSON 里 `"id":` 的出现次数（每处 5 字符）
   *   aiSeg   = 是否含 AI 分段标记（原来的 includes('"id":"p-') 改由 SQL 判断）
   * 段落数随合并/重新分段变化，必须实时算，不能缓存进 stats。
   */
  const COLS = `id,title,source,folder,excerpt,createdAt,completedAt,filePath,videoMeta,
    LENGTH(text) AS chars,
    (LENGTH(text) - LENGTH(REPLACE(text, ' ', '')) + 1) AS words,
    CASE WHEN segments IS NULL OR segments = '' THEN 0
         ELSE (LENGTH(segments) - LENGTH(REPLACE(segments, '"id":', ''))) / 5 END AS paraCount,
    CASE WHEN segments LIKE '%"id":"p-%' THEN 1 ELSE 0 END AS aiSeg`
  if (folder === 'all') {
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
    const aiSegmented = Number(r.aiSeg) === 1
    return {
      id: r.id, title: r.title || '未命名', source: r.source || 'paste', folder: r.folder || r.folder,
      excerpt: r.excerpt || '', createdAt: r.createdAt, completedAt: r.completedAt || null,
      length: Number(r.chars) || 0,
      words: Number(r.words) || 0,
      paraCount: Number(r.paraCount) || 0,
      readCount: s.readCount || 0, lastReadAt: s.lastReadAt || '', markCount: s.markCount || 0,
      duration, thumbnail, aiSegmented,
    }
  })

  setCache(cacheKey, result)
  return result
})
