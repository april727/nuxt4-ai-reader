import { queryAll } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const folder = (query.folder as string) || 'default'

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
  if (folder === 'all') {
    rows = await queryAll('SELECT id,title,source,folder,excerpt,createdAt,completedAt,0 as len,filePath,videoMeta,segments FROM texts ORDER BY createdAt DESC')
  } else {
    rows = await queryAll('SELECT id,title,source,folder,excerpt,createdAt,completedAt,0 as len,filePath,videoMeta,segments FROM texts WHERE folder=? ORDER BY createdAt DESC', [folder])
  }

  return rows.map((r: any) => {
    const s = statsMap.get(r.id) || {}
    let duration = 0
    let thumbnail = ''
    if (r.videoMeta) {
      try { const vm = JSON.parse(r.videoMeta); duration = vm.duration || 0; thumbnail = vm.thumbnail || '' } catch {}
    }
    // 缩略图 URL：远程 URL 直接使用，本地路径拼接 /api/file/
    if (thumbnail) {
      thumbnail = thumbnail.startsWith('http') ? thumbnail : `/api/file/${thumbnail}`
    }
    let aiSegmented = false
    if (r.segments) {
      try {
        const segs = JSON.parse(r.segments)
        aiSegmented = Array.isArray(segs) && segs.length > 0 && segs[0]?.id?.startsWith('p-')
      } catch {}
    }
    return {
      id: r.id, title: r.title || '未命名', source: r.source || 'paste', folder: r.folder || r.folder,
      excerpt: r.excerpt || '', createdAt: r.createdAt, completedAt: r.completedAt || null,
      length: Number(r.len) || 0,
      readCount: s.readCount || 0, lastReadAt: s.lastReadAt || '', markCount: s.markCount || 0,
      duration, thumbnail, aiSegmented,
    }
  })
})
