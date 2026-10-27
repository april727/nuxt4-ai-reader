/**
 * GET /api/pronounce/stats
 * 发音健康监控：查看音库连通性、缓存规模、覆盖率、慢词分布。
 *
 * 用法：
 *   /api/pronounce/stats                → 只看缓存统计（快）
 *   /api/pronounce/stats?probe=hello,world → 顺带探测指定词并回报
 */
import { cacheStats, pronUrlOf, probeWord } from '../../utils/pronounce'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const stats = cacheStats()

  const out: any = {
    ok: true,
    cache: stats,
    source: 'audio.beingfine.cn',
    base: 'https://audio.beingfine.cn/speeches/{UK|US}/{UK|US}-speech/{word}.mp3',
    note: '音库只收单词原形；变形词需先词形还原。CDN 无 CORS 头，浏览器无法直接 fetch 探测，故由服务端代理。',
  }

  // 连通性自检
  const t0 = Date.now()
  const ping = await probeWord('hello', 'UK')
  out.ping = { ok: ping === true, ms: Date.now() - t0 }

  // 指定词探测
  const probeRaw = String(q.probe || '').trim()
  if (probeRaw) {
    const words = probeRaw.split(',').map(w => w.trim().toLowerCase()).filter(Boolean).slice(0, 20)
    const items: any[] = []
    for (const w of words) {
      const t = Date.now()
      const ok = await probeWord(w, 'UK')
      items.push({ word: w, ok, ms: Date.now() - t, url: ok === true ? pronUrlOf(w, 'UK') : null })
    }
    out.probed = items
  }

  return out
})
