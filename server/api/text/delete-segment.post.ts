import { mutateSegments } from '../../utils/segmentsStore'
import { snapshotText } from '../../utils/textHistory'
import { existsSync, unlinkSync } from 'node:fs'
import { resolveFilePath } from '../../utils/storage'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    textId: string
    segmentId: string
  }>(event)

  if (!body?.textId || !body?.segmentId) {
    throw createError({ statusCode: 400, message: '缺少必要参数' })
  }

  // 删除前留快照
  await snapshotText(body.textId, '删除段落')

  // 先把图片文件名拿出来，删除成功后再清理文件（避免写库失败却已删图）
  let imageNames: string[] = []

  const result = await mutateSegments(body.textId, (segs, row) => {
    const segIdx = segs.findIndex((s: any) => s.id === body.segmentId)
    if (segIdx === -1) {
      // 已被删除（重试/并发）→ 幂等
      return { segments: segs, changed: false, meta: { reason: 'already_deleted' } }
    }
    const seg = segs[segIdx]
    if (seg.images?.length) imageNames = [...seg.images]

    const patch: Record<string, string> = {}

    // 标记
    let marks: any[] = []
    try { marks = row.marks ? JSON.parse(row.marks) : [] } catch {}
    const keptMarks = marks.filter((m: any) => m?.paragraphId !== body.segmentId)
    if (keptMarks.length !== marks.length) patch.marks = JSON.stringify(keptMarks)

    // 解释缓存
    let explanations: Record<string, string> = {}
    try { explanations = row.explanations ? JSON.parse(row.explanations) : {} } catch {}
    let expChanged = false
    for (const key of Object.keys(explanations)) {
      if (key.startsWith(body.segmentId + ':')) { delete explanations[key]; expChanged = true }
    }
    if (expChanged) patch.explanations = JSON.stringify(explanations)

    // 段落对话
    let paragraphChats: Record<string, any[]> = {}
    try { paragraphChats = row.paragraphChats ? JSON.parse(row.paragraphChats) : {} } catch {}
    if (paragraphChats[body.segmentId]) {
      delete paragraphChats[body.segmentId]
      patch.paragraphChats = JSON.stringify(paragraphChats)
    }

    // 阅读位置
    let readingPosition: any = null
    try { readingPosition = row.readingPosition ? JSON.parse(row.readingPosition) : null } catch {}
    if (readingPosition?.paragraphId === body.segmentId) {
      patch.readingPosition = ''
    }

    segs.splice(segIdx, 1)
    return { segments: segs, changed: true, patch }
  })

  // 删除生效后再清理图片文件
  if (result.changed) {
    for (const imgName of imageNames) {
      try {
        const imgPath = resolveFilePath(imgName)
        if (existsSync(imgPath)) unlinkSync(imgPath)
      } catch {
        // 文件不存在或无权限，跳过
      }
    }
  }

  return {
    ok: true,
    applied: result.changed,
    reason: result.meta?.reason || '',
    segments: result.segments,
  }
})
