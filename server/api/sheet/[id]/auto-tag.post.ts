import { queryOne } from '../../../utils/db'
import { resolveFilePath } from '../../../utils/storage'
import { deepseekVision, isDeepSeekConfigured } from '../../../utils/deepseek'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * AI 自动切题（单页或多页）。
 *
 * 只返回结果，**不写库**：切题必然有误判（页眉、大题标题、跨页题），
 * 让用户先看一眼再决定写入，比直接污染 annotations 好收场。
 * 写入仍走原有的 annotations 接口，kind='q'（题目），之后可以一键改成「错题」。
 *
 * 模型：DeepSeek 网关（多模态）。不能用阿里云 Qwen-VL —— 本机 key 没这个权限。
 */

const MAX_PAGES = 12
const MIME: Record<string, string> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
}

const SYSTEM = '你是试卷版面分析器，只输出 JSON，不写任何解释。'

function promptFor(pageNo: number, total: number) {
  return `这是第 ${pageNo}/${total} 页试卷图片。请把它切分成一道道独立题目。

规则：
- 一道题 = 从题号（如 1. / 2、/ (3) / ①②，含题干与选项）到下一题号之前的整块区域，纵向可以连续。
- 忽略：页眉页脚、页码、姓名学号栏、装订线、整页大标题、"阅读理解"这类大题说明（它不是一道题）。
- 阅读理解/完形填空：把每道小题分别切出来；若小题在原文段落里没有独立题号，则整块作为一道。
- 坐标按整幅图归一化到 0~1，原点在左上角。

严格按此结构输出：
{"questions":[{"no":"1","label":"短标签，如 时态选择/阅读理解/计算","box":[x,y,w,h]}]}
没有题目就输出 {"questions":[]}。`
}

/** 从模型输出里抠出 JSON（防 ```json 围栏和前后废话） */
function extractJson(text: string): any {
  const s = String(text || '').trim()
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : s
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(body.slice(start, end + 1)) } catch { return null }
}

function clamp01(v: any): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

function normBox(box: any) {
  // 兼容 [x,y,w,h] 与 {x,y,w,h}
  const [x, y, w, h] = Array.isArray(box)
    ? [box[0], box[1], box[2], box[3]]
    : [box?.x, box?.y, box?.w, box?.h]
  const nw = clamp01(w)
  const nh = clamp01(h)
  return {
    x: Math.min(clamp01(x), 1 - nw),
    y: Math.min(clamp01(y), 1 - nh),
    w: nw,
    h: nh,
  }
}

function dataUrlFor(key: string): string | null {
  if (!key) return null
  try {
    const p = resolveFilePath(key)
    if (!p) return null
    const ext = path.extname(p).toLowerCase()
    const mime = MIME[ext] || 'image/png'
    return `data:${mime};base64,${readFileSync(p).toString('base64')}`
  } catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: '缺少 id' })
  if (!isDeepSeekConfigured()) throw createError({ statusCode: 500, message: '未配置 DEEPSEEK_API_KEY' })

  const body = await readBody<{ pageIds?: string[] }>(event).catch(() => ({} as any))
  const row = await queryOne('SELECT id, segments FROM texts WHERE id=?', [id])
  if (!row) throw createError({ statusCode: 404, message: '试卷不存在' })

  let pages: any[] = []
  try { pages = JSON.parse(row.segments || '[]') } catch { pages = [] }
  if (!Array.isArray(pages) || !pages.length) throw createError({ statusCode: 400, message: '这份试卷没有页面' })

  const wanted = Array.isArray(body?.pageIds) && body!.pageIds!.length
    ? pages.filter(p => body!.pageIds!.includes(p.id))
    : pages
  if (!wanted.length) throw createError({ statusCode: 400, message: '指定的页面不存在' })
  if (wanted.length > MAX_PAGES) throw createError({ statusCode: 400, message: `一次最多 ${MAX_PAGES} 页` })

  const t0 = Date.now()
  const out: Array<{ pageId: string; regions: Array<{ no: string; label: string; bbox: any }>; raw?: string }> = []

  // 串行而不是并发：网关对并发比较敏感，且失败时串行更容易定位是哪一页
  for (let i = 0; i < wanted.length; i++) {
    const page = wanted[i]
    const dataUrl = dataUrlFor(String(page.key || ''))
    if (!dataUrl) {
      out.push({ pageId: String(page.id), regions: [], raw: '本地图片缺失' })
      continue
    }
    let text = ''
    try {
      text = await deepseekVision(promptFor(i + 1, wanted.length), [{ dataUrl, detail: 'high' }], {
        system: SYSTEM,
        timeoutMs: 180_000,
      })
    } catch (e: any) {
      out.push({ pageId: String(page.id), regions: [], raw: e?.message || '调用失败' })
      continue
    }

    const parsed = extractJson(text)
    const list = Array.isArray(parsed?.questions) ? parsed.questions : []
    const regions = list.map((q: any, idx: number) => {
      const bbox = normBox(q?.box)
      return {
        no: String(q?.no || idx + 1).slice(0, 12),
        label: String(q?.label || '').slice(0, 40),
        bbox,
      }
    }).filter((r: any) => r.bbox.w > 0.01 && r.bbox.h > 0.005)

    out.push({ pageId: String(page.id), regions, raw: regions.length ? undefined : String(text).slice(0, 300) })
    console.log(`[sheet/auto-tag] ${id} ${page.id} → ${regions.length} 题`)
  }

  return {
    ok: true,
    pages: out,
    total: out.reduce((s, p) => s + p.regions.length, 0),
    ms: Date.now() - t0,
  }
})
