import { mutateSegments } from '../../../utils/segmentsStore'

/**
 * 保存某一页的「答案遮挡区」（整体覆盖该页 covers）。
 *
 * 为什么不用 annotations 接口：遮挡区是页的属性（这张纸上哪块是答案），
 * 不是一道题。混进 annotations 会被错题本聚合、面板统计、页内编号
 * 全部当成一条标注 —— 于是"遮答案"会莫名多出一条"批注"。
 *
 * 为什么必须走 mutateSegments：covers 存在 texts.segments 里，而 segments 是
 * 整份读改写的 JSON 大字段。直接 UPDATE 会跟并发的段落/页面操作互相覆盖
 * （见 segmentsStore 顶部注释），这里沿用同一把锁 + CAS。
 */
const MAX_COVERS = 40

function clamp01(v: any): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: '缺少 id' })

  const body = await readBody<{ pageId?: string; covers?: any[] }>(event)
  const pageId = String(body?.pageId || '')
  if (!pageId) throw createError({ statusCode: 400, message: '缺少 pageId' })

  const raw = Array.isArray(body?.covers) ? body!.covers!.slice(0, MAX_COVERS) : []
  const covers = raw.map((c: any) => {
    const w = clamp01(c?.w)
    const h = clamp01(c?.h)
    return {
      x: Math.min(clamp01(c?.x), 1 - w),
      y: Math.min(clamp01(c?.y), 1 - h),
      w,
      h,
    }
  }).filter(c => c.w > 0.002 && c.h > 0.002)

  const result = await mutateSegments(id, (segs) => {
    const idx = segs.findIndex((p: any) => p && p.id === pageId)
    // 页面不存在：不回滚、不猜，直接告诉调用方
    if (idx < 0) return { segments: segs, changed: false, conflict: true }
    const prev = segs[idx]
    const nextPage = { ...prev }
    if (covers.length) nextPage.covers = covers
    else delete nextPage.covers
    // 内容没变就不要写库（避免每次打开页面都刷新 updatedAt 触发同步）
    if (JSON.stringify(prev.covers || []) === JSON.stringify(covers)) {
      return { segments: segs, changed: false }
    }
    const next = segs.slice()
    next[idx] = nextPage
    return { segments: next, changed: true }
  })

  if (result.conflict) throw createError({ statusCode: 404, message: '页面不存在' })
  return { ok: true, pageId, covers, changed: result.changed }
})
