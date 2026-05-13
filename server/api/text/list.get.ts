import { getDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const folder = (query.folder as string) || 'default'
  const db = await getDb()

  // 安全获取 stats 数据
  function getStats(db: any): Map<string, any> {
    const map = new Map()
    try {
      const s = db.prepare('SELECT * FROM stats')
      while (s.step()) { const r = s.getAsObject(); map.set(r.textId, r) }
      s.free()
    } catch {}
    return map
  }
  const statsMap = getStats(db)

  let stmt
  if (folder === 'all') {
    stmt = db.prepare('SELECT id,title,source,folder,excerpt,createdAt,length(text) as len,filePath FROM texts ORDER BY createdAt DESC')
  } else {
    stmt = db.prepare('SELECT id,title,source,folder,excerpt,createdAt,length(text) as len,filePath FROM texts WHERE folder=? ORDER BY createdAt DESC')
    stmt.bind([folder])
  }
  const rows: any[] = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()

  return rows.map((r: any) => {
    const s = statsMap.get(r.id) || {}
    return {
      id: r.id, title: r.title || '未命名', source: r.source || 'paste', folder: r.folder || r.folder,
      excerpt: r.excerpt || '', createdAt: r.createdAt, length: Number(r.len) || 0,
      readCount: s.readCount || 0, lastReadAt: s.lastReadAt || '', markCount: s.markCount || 0,
    }
  })
})
