import { assertPublicHttpUrl } from '../../utils/net'

/**
 * 缩略图代理：候选图来自第三方站点，直接 <img> 引用会遇到
 * http 混合内容、防盗链、跨域等问题，这里统一经本域转发。
 */
export default defineEventHandler(async (event) => {
  const raw = String(getQuery(event).url || '')
  if (!raw) throw createError({ statusCode: 400, message: '缺少 url 参数' })

  const url = assertPublicHttpUrl(raw)

  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; yu-reader/1.0)',
      'Accept': 'image/*,*/*;q=0.8',
      'Referer': `${url.protocol}//${url.host}/`,
    },
  })

  if (!res.ok || !res.body) {
    throw createError({ statusCode: 502, message: `缩略图获取失败 (${res.status})` })
  }

  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!contentType.startsWith('image/')) {
    throw createError({ statusCode: 415, message: '目标不是图片' })
  }

  setHeader(event, 'Content-Type', contentType)
  setHeader(event, 'Cache-Control', 'public, max-age=86400')
  return res.body
})
