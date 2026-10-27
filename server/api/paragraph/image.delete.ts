import { mutateSegments } from '../../utils/segmentsStore'
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

  // 改 segments 走统一串行通道：图片增删也会重写整份段落数组，
  // 若与合并/插入并发，整份覆盖会把对方的改动顶掉
  await mutateSegments(body.id, (segments) => {
    const para = segments.find((s: any) => s.id === body.paragraphId)
    if (!para?.images?.length) return { segments, changed: false }
    const next = para.images.filter((n: string) => n !== body.imageName)
    if (next.length === para.images.length) return { segments, changed: false }
    para.images = next
    return { segments, changed: true }
  })

  return { ok: true }
})
