import { queryOne, runQuery, deleteRowsFromTurso } from './db'
import { moveToTrash } from './storage'
import { useR2, r2Delete } from './r2'
import { cleanupImages, extractImageUrls } from './imageCleanup'
import { pendingR2Put } from './imageStore'

/** 恢复被软删除的文件/书：清除 deletedAt，同时恢复其标记 */
export async function restoreText(id: string): Promise<{ ok: boolean }> {
  const exists = await queryOne('SELECT id FROM texts WHERE id=?', [id])
  if (!exists) return { ok: false }
  const now = new Date().toISOString()
  await runQuery('UPDATE texts SET deletedAt=NULL, updatedAt=? WHERE id=?', [now, id])
  await runQuery('UPDATE marks SET deletedAt=NULL WHERE textId=?', [id])
  // 来源恢复后，词条不再处于「原文已删除」状态
  try { await runQuery("UPDATE words SET orphanedAt='' WHERE source=?", [id]) } catch {}
  return { ok: true }
}

/** 批量删除 R2 对象（尽力而为，单个失败不阻塞） */
async function deleteR2Keys(keys: string[]) {
  if (!useR2()) return
  const seen = new Set<string>()
  for (const k of keys) {
    if (!k || seen.has(k)) continue
    seen.add(k)
    try {
      // 先等这张图的后台补传落地，否则删完可能又被 put 写回去（见 imageStore.pendingR2Put）
      const inflight = pendingR2Put(k)
      if (inflight) await inflight
      await r2Delete(k)
    } catch (e: any) {
      console.warn(`[r2-clean] 删除 R2 对象失败: ${k} (${e.message})`)
    }
  }
}

/** 收集一个文本关联的所有 R2 key（源文件、缩略图、段落图片） */
function collectTextKeys(row: any): string[] {
  const keys: string[] = []
  if (row.filePath) keys.push(row.filePath)
  if (row.videoMeta) {
    try {
      const vm = JSON.parse(row.videoMeta)
      if (vm.thumbnail) keys.push(String(vm.thumbnail).replace(/^\/api\/file\//, ''))
    } catch {}
  }
  if (row.segments) {
    try {
      const segs = JSON.parse(row.segments)
      for (const s of segs) {
        // 文字文章：段落插图挂在 images 上
        if (Array.isArray(s.images)) keys.push(...s.images)
        // 图片试卷：segments 直接是页数组，每页自带 R2 key，
        // 不收集的话删试卷只清本地目录、云端对象会一直留着
        if (s && typeof s.key === 'string') keys.push(s.key)
      }
    } catch {}
  }
  return keys.filter(Boolean)
}

/** 彻底删除文件/书：移磁盘文件到垃圾箱 + 清理 R2 对象 + 硬删除本地与云端记录 */
export async function permanentDeleteText(id: string): Promise<{ ok: boolean }> {
  // 先取完整行，收集 R2 key；再把磁盘文件移到垃圾箱（软删除时文件仍在原位）
  const row = await queryOne('SELECT * FROM texts WHERE id=?', [id])
  let detachedImages: string[] = []
  if (row) {
    // 标记解析里的配图 + 封面：这些不在 collectTextKeys 里，需要单独收集
    try {
      const marks = JSON.parse(row.marks || '[]')
      for (const m of marks) detachedImages.push(...extractImageUrls(m.detail || ''))
      if (row.cover) detachedImages.push(row.cover)
    } catch {}
    moveToTrash(row.folder || 'default', id, row.title || id)
    await deleteR2Keys(collectTextKeys(row))
  }

  await runQuery('DELETE FROM marks WHERE textId=?', [id])
  await runQuery('DELETE FROM texts WHERE id=?', [id])
  await runQuery('DELETE FROM stats WHERE textId=?', [id])

  await deleteRowsFromTurso('texts', 'id', [id])
  await deleteRowsFromTurso('marks', 'textId', [id])
  await deleteRowsFromTurso('stats', 'textId', [id])

  // 行已删除，引用检查不会命中自己；仍被其他文本引用的图会保留
  if (detachedImages.length) await cleanupImages([...new Set(detachedImages)])

  return { ok: true }
}
