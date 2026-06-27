import { queryOne, runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    textId: string
    upperParagraphId: string
    lowerParagraphId: string
  }>(event)

  if (!body?.textId || !body?.upperParagraphId || !body?.lowerParagraphId) {
    throw createError({ statusCode: 400, message: '缺少必要参数' })
  }

  // 加载文本和段落
  const textRow = await queryOne('SELECT * FROM texts WHERE id=?', [body.textId])
  if (!textRow) throw createError({ statusCode: 404, message: '文本不存在' })

  let segs: any[] = []
  try { segs = JSON.parse(textRow.segments || '[]') } catch {}

  const upperIdx = segs.findIndex((s: any) => s.id === body.upperParagraphId)
  const lowerIdx = segs.findIndex((s: any) => s.id === body.lowerParagraphId)
  if (upperIdx === -1 || lowerIdx === -1) {
    throw createError({ statusCode: 404, message: '段落不存在' })
  }

  const upper = segs[upperIdx]
  const lower = segs[lowerIdx]

  // 合并文本
  const separator = '\n'
  upper.text = upper.text + separator + lower.text

  // 合并图片
  if (lower.images?.length) {
    upper.images = [...(upper.images || []), ...lower.images]
  }

  // 合并段落对话历史
  let paragraphChats: Record<string, any[]> = {}
  try { paragraphChats = textRow.paragraphChats ? JSON.parse(textRow.paragraphChats) : {} } catch {}
  const upperChats = paragraphChats[body.upperParagraphId] || []
  const lowerChats = paragraphChats[body.lowerParagraphId] || []
  if (lowerChats.length > 0) {
    // 在两段对话之间插入分隔标记
    const separatorMsg = {
      role: 'system' as const,
      content: '── 以下对话来自合并前的下方段落 ──',
    }
    paragraphChats[body.upperParagraphId] = [...upperChats, separatorMsg, ...lowerChats]
  }
  delete paragraphChats[body.lowerParagraphId]

  // 处理标记：将 lower 段落的标记迁移到 upper
  let marks: any[] = []
  try { marks = textRow.marks ? JSON.parse(textRow.marks) : [] } catch {}
  const upperTextLen = upper.text.length - lower.text.length - separator.length // upper 原始长度
  for (const m of marks) {
    if (m.paragraphId === body.lowerParagraphId) {
      m.paragraphId = body.upperParagraphId
      m.startOffset += upperTextLen + separator.length
      m.endOffset += upperTextLen + separator.length
    }
  }

  // 删除 lower 段落并重排索引
  segs.splice(lowerIdx, 1)
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].index !== i) {
      segs[i].index = i
    }
  }

  // 清除 AI 缓存（内容变了，旧解释不再准确）
  let explanations: Record<string, string> = {}
  try { explanations = textRow.explanations ? JSON.parse(textRow.explanations) : {} } catch {}
  // 只清除被合并段落的缓存
  for (const key of Object.keys(explanations)) {
    if (key.startsWith(body.upperParagraphId + ':')) {
      delete explanations[key]
    }
  }

  await runQuery(
    `UPDATE texts SET segments=?,marks=?,explanations=?,paragraphChats=?,updatedAt=? WHERE id=?`,
    [
      JSON.stringify(segs),
      JSON.stringify(marks),
      JSON.stringify(explanations),
      JSON.stringify(paragraphChats),
      new Date().toISOString(),
      body.textId,
    ]
  )

  return { ok: true, segments: segs, marks, paragraphChats }
})
