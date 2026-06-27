import { queryAll } from '../../utils/db'

export default defineEventHandler(async () => {
  const rows = await queryAll(
    'SELECT * FROM knowledge_points ORDER BY sourceTitle, sortOrder DESC, createdAt DESC'
  )

  return rows.map((r: any) => ({
    id: r.id,
    content: r.content,
    note: r.note || '',
    sourceId: r.sourceId || '',
    sourceTitle: r.sourceTitle || '',
    sourceType: r.sourceType || 'selection',
    sourceContext: r.sourceContext || '',
    customGroup: r.customGroup || '',
    chatHistory: (() => { try { return JSON.parse(r.chatHistory || '[]') } catch { return [] } })(),
    tags: (() => { try { return JSON.parse(r.tags || '[]') } catch { return [] } })(),
    sortOrder: r.sortOrder || 0,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }))
})
