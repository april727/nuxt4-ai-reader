import { mutateSegments } from '../../utils/segmentsStore'
import { snapshotText } from '../../utils/textHistory'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    textId: string
    beforeParagraphId?: string
    afterParagraphId?: string
    segmentId: string
    text: string
  }>(event)

  if (!body?.textId || !body?.segmentId || !body?.text?.trim()) {
    throw createError({ statusCode: 400, message: '缺少必要参数' })
  }
  if (!body.beforeParagraphId && !body.afterParagraphId) {
    throw createError({ statusCode: 400, message: '必须指定 beforeParagraphId 或 afterParagraphId' })
  }

  // 插入前留快照
  await snapshotText(body.textId, '插入段落')

  const refId = body.beforeParagraphId || body.afterParagraphId

  const result = await mutateSegments(body.textId, (segs) => {
    const refIdx = segs.findIndex((s: any) => s.id === refId)
    if (refIdx === -1) {
      // 参考段落已不存在（结构被并发改过）：不插入，返回最新结构让客户端对齐
      return { segments: segs, changed: false, conflict: true, meta: { reason: 'ref_missing' } }
    }
    if (segs.some((s: any) => s.id === body.segmentId)) {
      // 同一段落已插入过（重试）→ 幂等
      return { segments: segs, changed: false, meta: { reason: 'already_inserted' } }
    }

    const insertIdx = body.beforeParagraphId ? refIdx : refIdx + 1
    segs.splice(insertIdx, 0, { id: body.segmentId, index: insertIdx, text: body.text.trim() })
    return { segments: segs, changed: true }
  })

  return {
    ok: true,
    applied: result.changed,
    conflict: !!result.conflict,
    reason: result.meta?.reason || '',
    segments: result.segments,
  }
})
