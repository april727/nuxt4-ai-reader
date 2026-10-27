import { queryOne, runQuery } from './db'
import { syncMarks } from './marksSync'
import { cleanupImages, extractImageUrls } from './imageCleanup'

/**
 * 修改某标记的软删除状态（回收站操作）。
 * @param markId 标记 id
 * @param action 'restore'=恢复（清除 deletedAt）；'permanent'=彻底删除（从数组移除）
 */
export async function modifyMarkInText(markId: string, action: 'restore' | 'permanent'): Promise<{ ok: boolean; textId?: string }> {
  const markRow = await queryOne('SELECT textId FROM marks WHERE id=?', [markId])
  if (!markRow?.textId) return { ok: false }
  const textId = markRow.textId
  const text = await queryOne('SELECT * FROM texts WHERE id=?', [textId])
  if (!text) return { ok: false }

  let marks: any[] = []
  try { marks = JSON.parse(text.marks || '[]') } catch { marks = [] }
  const oldJson = text.marks || '[]'

  if (action === 'restore') {
    // 恢复：清除 deletedAt（设为 undefined，JSON.stringify 时会省略该字段）
    marks = marks.map((m: any) => m.id === markId ? { ...m, deletedAt: undefined } : m)
  } else {
    // 彻底删除：从数组移除
    marks = marks.filter((m: any) => m.id !== markId)
  }

  const newJson = JSON.stringify(marks)
  await runQuery('UPDATE texts SET marks=?, updatedAt=? WHERE id=?', [newJson, new Date().toISOString(), textId])
  await syncMarks(textId, text.title || '', text.folder || 'default', oldJson, newJson)

  // 彻底删除时清理该标记独有的配图（仍被别处引用的会保留）
  if (action === 'permanent') {
    const target = JSON.parse(oldJson || '[]').find((m: any) => m.id === markId)
    const urls = extractImageUrls(target?.detail || '')
    if (urls.length) await cleanupImages(urls)
  }

  return { ok: true, textId }
}
