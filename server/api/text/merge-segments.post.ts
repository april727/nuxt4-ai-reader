import { mutateSegments } from '../../utils/segmentsStore'
import { snapshotText } from '../../utils/textHistory'

/**
 * 合并两个相邻段落。
 *
 * 关键约束（都是踩过的坑）：
 * 1. 只允许合并**相邻**的两段。旧实现按 id 找下标后直接拼，若请求基于过期结构
 *    （用户连点、或后台分段刚写过），lower 可能并不在 upper 下一行，拼出来就是
 *    内容错序的段落 —— 这正是"合并后段落混乱"的直接成因。
 * 2. 全程走 mutateSegments 的串行锁 + CAS：并发请求不会互相覆盖。
 * 3. lower 已被合并/删除时按幂等处理（返回当前结构，让客户端对齐），
 *    这样用户重试、或两个请求撞车时都不会产生第二份合并。
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    textId: string
    upperParagraphId: string
    lowerParagraphId: string
  }>(event)

  if (!body?.textId || !body?.upperParagraphId || !body?.lowerParagraphId) {
    throw createError({ statusCode: 400, message: '缺少必要参数' })
  }

  // 合并前留快照
  await snapshotText(body.textId, '合并段落')

  const SEP = '\n'
  let mergedMarks: any[] | null = null
  let mergedChats: Record<string, any[]> | null = null

  const result = await mutateSegments(body.textId, (segs, row) => {
    const upperIdx = segs.findIndex((s: any) => s.id === body.upperParagraphId)
    if (upperIdx === -1) {
      // 客户端还在用一份已经过期的结构：不猜、不写，直接把最新结构还给它
      return { segments: segs, changed: false, conflict: true, meta: { reason: 'upper_missing' } }
    }

    const lowerIdx = segs.findIndex((s: any) => s.id === body.lowerParagraphId)
    if (lowerIdx === -1) {
      // 目标段已经不存在（上一次合并已生效 / 被删除）→ 幂等：不重复合并
      return { segments: segs, changed: false, meta: { reason: 'already_merged' } }
    }
    if (lowerIdx !== upperIdx + 1) {
      // 两段已不相邻：中间被插入过内容，或结构被其它操作改过。宁可不合，也不能拼错顺序
      return {
        segments: segs,
        changed: false,
        conflict: true,
        meta: { reason: 'not_adjacent', upperIdx, lowerIdx },
      }
    }

    const upper = segs[upperIdx]
    const lower = segs[lowerIdx]
    const upperOriginalLen = String(upper.text || '').length

    // ── 文本 ──
    upper.text = String(upper.text || '') + SEP + String(lower.text || '')

    // ── 图片 ──
    if (lower.images?.length) {
      upper.images = [...(upper.images || []), ...lower.images]
    }
    // 视频段落：保留更靠后的结束时间
    if (typeof lower.end === 'number' && (typeof upper.end !== 'number' || lower.end > upper.end)) {
      upper.end = lower.end
    }

    // ── 标记迁移：lower 的字符偏移平移到合并后的位置 ──
    const patch: Record<string, string> = {}
    let marks: any[] = []
    try { marks = row.marks ? JSON.parse(row.marks) : [] } catch { marks = [] }
    let marksChanged = false
    for (const m of marks) {
      if (m?.paragraphId !== body.lowerParagraphId) continue
      m.paragraphId = body.upperParagraphId
      m.startOffset = Number(m.startOffset || 0) + upperOriginalLen + SEP.length
      m.endOffset = Number(m.endOffset || 0) + upperOriginalLen + SEP.length
      marksChanged = true
    }
    if (marksChanged) {
      mergedMarks = marks
      patch.marks = JSON.stringify(marks)
    }

    // ── 段落对话迁移 ──
    let chats: Record<string, any[]> = {}
    try { chats = row.paragraphChats ? JSON.parse(row.paragraphChats) : {} } catch {}
    const lowerChats = chats[body.lowerParagraphId] || []
    if (lowerChats.length) {
      const upperChats = chats[body.upperParagraphId] || []
      chats[body.upperParagraphId] = [
        ...upperChats,
        { role: 'system', content: '── 以下对话来自合并前的下方段落 ──' },
        ...lowerChats,
      ]
      mergedChats = chats
    }
    delete chats[body.lowerParagraphId]
    if (lowerChats.length) patch.paragraphChats = JSON.stringify(chats)

    // ── 解释缓存：内容变了，旧的讲解/翻译不再准确 ──
    let explanations: Record<string, string> = {}
    try { explanations = row.explanations ? JSON.parse(row.explanations) : {} } catch {}
    let expChanged = false
    for (const key of Object.keys(explanations)) {
      if (key.startsWith(body.upperParagraphId + ':')) { delete explanations[key]; expChanged = true }
      if (key.startsWith(body.lowerParagraphId + ':')) { delete explanations[key]; expChanged = true }
    }
    if (expChanged) patch.explanations = JSON.stringify(explanations)

    segs.splice(lowerIdx, 1)
    return { segments: segs, changed: true, patch }
  })

  return {
    ok: true,
    applied: result.changed,
    conflict: !!result.conflict,
    reason: result.meta?.reason || '',
    segments: result.segments,
    marks: mergedMarks,
    paragraphChats: mergedChats,
  }
})
