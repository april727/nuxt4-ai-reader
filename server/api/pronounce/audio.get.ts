/**
 * 发音音频代理
 *
 * 为什么需要：音库 CDN（audio.beingfine.cn）开启防盗链，
 * 对陌生 Referer 直接 403 —— 发布域被拒，本地 localhost 却放行，
 * 于是出现"本地能发音、线上完全没声音"。
 *
 * 两层应对：
 *   1. 浏览器端给音频元素设 referrerPolicy='no-referrer'（首选，零成本）
 *   2. 仍失败时改走本代理：服务端请求不带 Referer，必定能取到音频
 *
 * 只放行音库域名，避免被当作任意 URL 的开放代理（SSRF 风险）。
 */
const ALLOWED_HOSTS = new Set(['audio.beingfine.cn'])

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const raw = String(q.u || '')
  if (!raw) throw createError({ statusCode: 400, message: '缺少音频地址' })

  let target: URL
  try {
    target = new URL(raw)
  } catch {
    throw createError({ statusCode: 400, message: '音频地址无效' })
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw createError({ statusCode: 400, message: '仅支持 http(s) 地址' })
  }
  if (!ALLOWED_HOSTS.has(target.hostname)) {
    throw createError({ statusCode: 403, message: '不允许代理该域名' })
  }

  const res = await fetch(target.toString(), {
    // 关键：不带 Referer，绕过防盗链
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; yu-reader/1.0)', Accept: 'audio/*,*/*;q=0.8' },
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    throw createError({ statusCode: 502, message: `音频获取失败 (${res.status})` })
  }

  const buf = Buffer.from(await res.arrayBuffer())
  setHeader(event, 'Content-Type', res.headers.get('content-type') || 'audio/mpeg')
  setHeader(event, 'Content-Length', String(buf.length))
  // 音库是静态资源：长缓存，避免每次点击都回源
  setHeader(event, 'Cache-Control', 'public, max-age=604800, immutable')
  return buf
})
