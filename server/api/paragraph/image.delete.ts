import { queryOne, runQuery } from '../../utils/db'
import { resolveFilePath } from '../../utils/storage'
import { useR2, r2Delete } from '../../utils/r2'
import { unlinkSync, existsSync } from 'node:fs'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string; paragraphId: string; imageName: string }>(event)
  if (!body?.id || !body.paragraphId || !body.imageName) {
    throw createError({ statusCode: 400 })
  }

  // 从 R2 删除图片对象（尽力而为）
  if (useR2()) {
    try {
      await r2Delete(body.imageName)
    } catch (e: any) {
      console.warn(`[r2-clean] 删除 R2 图片失败: ${body.imageName} (${e.message})`)
    }
  }

  // 从本地磁盘删除图片文件（尽力而为）
  try {
    const p = resolveFilePath(body.imageName)
    if (existsSync(p)) unlinkSync(p)
  } catch {}

  const segRow = await queryOne('SELECT segments FROM texts WHERE id=?', [body.id])
  if (!segRow) throw createError({ statusCode: 404 })

  let segments: any[] = []
  try { segments = JSON.parse(segRow.segments || '[]') } catch {}

  const para = segments.find((s: any) => s.id === body.paragraphId)
  if (para?.images) {
    para.images = para.images.filter((n: string) => n !== body.imageName)
  }

  await runQuery('UPDATE texts SET segments=?,updatedAt=? WHERE id=?',
    [JSON.stringify(segments), new Date().toISOString(), body.id])

  return { ok: true }
})
