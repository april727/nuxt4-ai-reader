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
    stmt = db.prepare('SELECT id,title,source,folder,excerpt,createdAt,completedAt,length(text) as len,filePath,videoMeta FROM texts ORDER BY createdAt DESC')
  } else {
    stmt = db.prepare('SELECT id,title,source,folder,excerpt,createdAt,completedAt,length(text) as len,filePath,videoMeta FROM texts WHERE folder=? ORDER BY createdAt DESC')
    stmt.bind([folder])
  }
  const rows: any[] = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()

  return rows.map((r: any) => {
    const s = statsMap.get(r.id) || {}
    let duration = 0
    let thumbnail = ''
    if (r.videoMeta) {
      try { const vm = JSON.parse(r.videoMeta); duration = vm.duration || 0; thumbnail = vm.thumbnail || '' } catch {}
    }
    return {
      id: r.id, title: r.title || '未命名', source: r.source || 'paste', folder: r.folder || r.folder,
      excerpt: r.excerpt || '', createdAt: r.createdAt, completedAt: r.completedAt || null,
      length: Number(r.len) || 0,
      readCount: s.readCount || 0, lastReadAt: s.lastReadAt || '', markCount: s.markCount || 0,
      duration, thumbnail,
    }
  })
})
