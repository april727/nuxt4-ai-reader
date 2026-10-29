import { mutateSegments } from '../../utils/segmentsStore'
import { snapshotText } from '../../utils/textHistory'
import { stripMarkdownImage } from '../../../shared/utils/markdownImage'

/**
 * 从段落 markdown 里移除一张内嵌图片（阅读页点图片右上角的 ×）。
 *
 * 为什么必须在服务端算：
 * 客户端手里的 `para.text` 可能已经过期（页面打开后别处改过段落、或本地还留着
 * 上一次的乐观状态）。如果客户端"读旧文本 → 删掉一张 → 整段写回"，就会把服务端
 * 的其它改动一起抹掉 —— 实测踩过：库里 3 张图，页面拿的是 2 张的旧文本，点一次
 * × 直接剩 1 张。所以客户端只传「哪一段、哪张图」，文本由服务端现读现改。
 *
 * 删完会变空的操作**不在这里做**：直接写空文本会留下一个空段落（页面上一块空白），
 * 连带还要清理 marks / 解释缓存 / 阅读位置 —— 那些是 delete-segment 的职责。
 * 这里只回报 `wouldEmpty`，由客户端确认后调 delete-segment。
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    textId: string
    segmentId: string
    src: string
    ordinal?: number
  }>(event)

  if (!body?.textId || !body?.segmentId || !body?.src) {
    throw createError({ statusCode: 400, message: '缺少必要参数' })
  }

  await snapshotText(body.textId, '移除段落图片')

  let outcome: 'ok' | 'not_found' | 'missing' = 'not_found'
  let wouldEmpty = false

  const result = await mutateSegments(body.textId, (segs) => {
    const seg = segs.find((s: any) => s.id === body.segmentId)
    if (!seg) {
      outcome = 'missing'
      return { segments: segs, changed: false, conflict: true, meta: { reason: 'segment_missing' } }
    }

    const next = stripMarkdownImage(String(seg.text || ''), body.src, body.ordinal ?? 0)
    if (next === null) {
      outcome = 'not_found'
      return { segments: segs, changed: false }
    }
    if (!next.trim()) {
      // 这张图是本段唯一内容：不写空段落，交给客户端决定是否整段删除
      wouldEmpty = true
      outcome = 'ok'
      return { segments: segs, changed: false }
    }

    seg.text = next
    outcome = 'ok'
    return { segments: segs, changed: true }
  })

  return {
    ok: outcome !== 'missing' && outcome !== 'not_found',
    outcome,
    applied: result.changed,
    wouldEmpty,
    reason: (result as any).meta?.reason || '',
    segments: result.segments,
  }
})
