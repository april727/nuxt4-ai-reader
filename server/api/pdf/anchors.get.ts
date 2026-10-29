/**
 * PDF 原页锚点表：段落 → 页码、标记 → 矩形。
 *
 * 客户端打开「原页」视图时拉一次，之后高亮全在本地渲染，不再请求。
 * 一次返回整篇而不是「按标记逐个查」：
 *   - 对齐本身是整篇顺序做的（流式窗口），逐条查会把同一份对齐算 N 遍
 *   - 50 条标记 × 2~3 个矩形也就十来 KB，远小于重新对齐的 CPU 成本
 *
 * 没有 layout.json（老文章 / 走回退路径导入的）时返回 ok:false，
 * 客户端据此提示「重新导入即可获得原页高亮」，而不是报错。
 */
import { queryOne } from '../../utils/db'
import { buildAnchors } from '../../utils/pdfLayout'

/** 对齐结果按 (textId, segments 长度, marks 长度) 缓存 —— 段落或标记一改就失效 */
const cache = new Map<string, { key: string; data: any }>()
const CACHE_MAX = 12

export default defineEventHandler(async (event) => {
  const textId = String(getQuery(event).id || '')
  if (!textId) throw createError({ statusCode: 400, message: '缺少 id' })

  const row = await queryOne(
    'SELECT id, segments, marks, filePath FROM texts WHERE id=?',
    [textId],
  )
  if (!row) throw createError({ statusCode: 404, message: '文章不存在' })
  if (!row.filePath || !/\.pdf$/i.test(String(row.filePath))) {
    return { ok: false, reason: 'not-pdf' }
  }

  let segments: any[] = []
  let marks: any[] = []
  try { segments = JSON.parse(row.segments || '[]') } catch {}
  try { marks = JSON.parse(row.marks || '[]') } catch {}
  if (!segments.length) return { ok: false, reason: 'no-segments' }

  const key = `${segments.length}:${row.segments.length}:${marks.length}`
  const hit = cache.get(textId)
  if (hit && hit.key === key) return hit.data

  const anchors = buildAnchors(
    textId,
    segments.map((s: any) => ({ id: String(s.id), text: String(s.text || '') })),
    marks.map((m: any) => ({
      id: String(m.id),
      paragraphId: String(m.paragraphId || ''),
      startOffset: Number(m.startOffset) || 0,
      endOffset: Number(m.endOffset) || 0,
      deletedAt: m.deletedAt,
    })),
  )

  if (!anchors) return { ok: false, reason: 'no-layout' }

  const data = { ok: true, ...anchors }
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(textId, { key, data })
  return data
})
