import { mutateSegments } from '../../utils/segmentsStore'
import { snapshotText } from '../../utils/textHistory'

/**
 * 修改单个段落文本。
 *
 * 注意：这里同样不能读整份写整份 —— 用户可能在等待期间合并了段落，
 * 整份覆盖会把合并结果回退成旧结构（表现为"改完一段，别的段又乱了"）。
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ textId: string; segmentId: string; text: string }>(event)
  if (!body?.textId || !body?.segmentId || !body?.text?.trim()) throw createError({ statusCode: 400 })

  // 编辑前留快照
  await snapshotText(body.textId, '编辑段落')

  const nextText = body.text.trim()

  const result = await mutateSegments(body.textId, (segs) => {
    const seg = segs.find((s: any) => s.id === body.segmentId)
    if (!seg) {
      // 段落已不存在（被合并/删除）→ 不重建，交给客户端对齐
      return { segments: segs, changed: false, conflict: true, meta: { reason: 'segment_missing' } }
    }
    if (String(seg.text || '') === nextText) {
      return { segments: segs, changed: false }
    }
    seg.text = nextText
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
