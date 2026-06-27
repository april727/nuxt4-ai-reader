import { queryAll } from '../../utils/db'

export default defineEventHandler(async () => {
  const allRows = await queryAll("SELECT id, title, videoMeta FROM texts WHERE source IN ('youtube','bilibili')")
  const rows: any[] = []
  for (const r of allRows) {
    let meta: any = {}
    try { meta = JSON.parse(r.videoMeta || '{}') } catch {}
    if (meta.thumbnail && meta.thumbnail.startsWith('http')) {
      rows.push({ id: r.id, title: r.title, thumbUrl: meta.thumbnail })
    }
  }
  return rows
})
