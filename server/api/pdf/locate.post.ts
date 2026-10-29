/**
 * 原页选区 → 段落偏移。
 *
 * 「在 PDF 原文上直接划词标记」的中间一步：前端只知道用户在第几页选了哪串字，
 * 标记真正要存的是 { paragraphId, startOffset, endOffset }，换算只能在后端做
 * —— 段落文本和坐标表的对齐表就在这边，客户端没有。
 *
 * 刻意**不**在客户端用 indexOf 搜：PDF 行尾断词、连字、抽取错字会让选区文本
 * 和段落文本对不上，搜不到就成了「点了没反应」。这里走词级对齐表，中间坏一两个
 * 词也能继续往下落。（见 pdfLayout.locateSelection）
 *
 * 返回 ok:false 时客户端要明确提示，不能静默失败。
 */
import { queryOne } from '../../utils/db'
import { locateSelection, readLayout } from '../../utils/pdfLayout'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const textId = String(body?.id || '')
  const text = String(body?.text || '').trim()
  const page = Number(body?.page) || null
  if (!textId) throw createError({ statusCode: 400, message: '缺少 id' })
  if (!text) return { ok: false, reason: 'empty-selection' }
  if (text.length > 4000) return { ok: false, reason: 'too-long' }

  // 老文章（或走回退路径导入的）没有坐标表，客户端要提示「重新导入」而不是
  // 「定位失败」—— 这两句对用户意味着完全不同的动作
  if (!readLayout(textId)) return { ok: false, reason: 'no-layout' }

  const row = await queryOne('SELECT id, segments FROM texts WHERE id=?', [textId])
  if (!row) throw createError({ statusCode: 404, message: '文章不存在' })

  let segments: any[] = []
  try { segments = JSON.parse(row.segments || '[]') } catch {}
  if (!segments.length) return { ok: false, reason: 'no-segments' }

  const hit = locateSelection(
    textId,
    segments.map((s: any) => ({ id: String(s.id), text: String(s.text || '') })),
    { text, page },
  )
  if (!hit) return { ok: false, reason: 'no-match' }

  return { ok: true, ...hit }
})
