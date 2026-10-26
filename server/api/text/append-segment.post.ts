import { mutateSegments } from '../../utils/segmentsStore'
import { snapshotText } from '../../utils/textHistory'

/**
 * 段尾追加：把文字接到目标段落的**文字末尾**，不新增段落。
 *
 * 与 insert-segment 的区别：
 * - insert-segment 会新增一段，段落数 +1；新段若插在两段之间，会把原本相邻的两段拆开，
 *   这两段就再也无法直接合并（合并只允许相邻）。用户「先补一段内容，回头再把上下两段并起来」
 *   的工作流因此被卡住。
 * - 本接口保持段落数不变，上下两段仍相邻，随时可以继续合并。
 *
 * 实现要点：
 * 1. 走 mutateSegments 串行通道 + CAS，避免与合并/编辑互相覆盖；
 * 2. 只在末尾追加，已有标记的字符偏移不受影响，无需迁移；
 * 3. 段落内容变了，该段旧的讲解/翻译缓存必须清掉（否则会拿旧解释对照新文字）。
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    textId: string
    paragraphId: string
    text: string
  }>(event)

  if (!body?.textId || !body?.paragraphId || !body.text?.trim()) {
    throw createError({ statusCode: 400, message: '缺少必要参数' })
  }

  const addText = body.text.trim()

  await snapshotText(body.textId, '段尾追加')

  const result = await mutateSegments(body.textId, (segs, row) => {
    const idx = segs.findIndex((s: any) => s.id === body.paragraphId)
    if (idx === -1) {
      // 段落已被合并/删除（结构变了）：不猜、不写，把最新结构还给客户端
      return { segments: segs, changed: false, conflict: true, meta: { reason: 'paragraph_missing' } }
    }

    const seg = segs[idx]
    const prev = String(seg.text || '')
    // 已经追加过同样内容（重试/连点）→ 幂等，避免重复叠一遍
    if (prev.endsWith(addText)) {
      return { segments: segs, changed: false, meta: { reason: 'already_appended' } }
    }
    seg.text = prev ? `${prev.replace(/\s+$/, '')}\n${addText}` : addText

    // 内容变了 → 清掉该段的解释/翻译缓存
    let explanations: Record<string, string> = {}
    try { explanations = row?.explanations ? JSON.parse(row.explanations) : {} } catch {}
    let expChanged = false
    for (const key of Object.keys(explanations)) {
      if (key.startsWith(body.paragraphId + ':')) { delete explanations[key]; expChanged = true }
    }

    return {
      segments: segs,
      changed: true,
      patch: expChanged ? { explanations: JSON.stringify(explanations) } : undefined,
    }
  })

  return {
    ok: true,
    applied: result.changed,
    conflict: !!result.conflict,
    reason: result.meta?.reason || '',
    segments: result.segments,
  }
})
