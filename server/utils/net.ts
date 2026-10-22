/**
 * 外部 URL 安全校验（用于图片代理与下载）。
 * 只允许 http/https，并拒绝内网、回环、链路本地地址，避免 SSRF。
 */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw createError({ statusCode: 400, message: '无效的图片地址' })
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw createError({ statusCode: 400, message: '仅支持 http/https 图片地址' })
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (host === 'localhost' || host === '0.0.0.0' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw createError({ statusCode: 400, message: '不允许访问内网地址' })
  }
  // IPv4 私有 / 回环 / 链路本地
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) {
    throw createError({ statusCode: 400, message: '不允许访问内网地址' })
  }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw createError({ statusCode: 400, message: '不允许访问内网地址' })
  }
  // IPv6 回环 / 唯一本地 / 链路本地
  if (host === '::1' || /^(fc|fd|fe80)/i.test(host)) {
    throw createError({ statusCode: 400, message: '不允许访问内网地址' })
  }

  return url
}

/** 带体积上限的图片下载，返回二进制与内容类型 */
export async function fetchImageBuffer(
  rawUrl: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<{ data: Buffer; contentType: string; finalUrl: string }> {
  const { timeoutMs = 12_000, maxBytes = 10 * 1024 * 1024 } = opts
  const url = assertPublicHttpUrl(rawUrl)

  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; yu-reader/1.0)',
      'Accept': 'image/*,*/*;q=0.8',
    },
  })

  if (!res.ok) {
    throw createError({ statusCode: 502, message: `图片下载失败 (${res.status})` })
  }

  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!contentType.startsWith('image/')) {
    throw createError({ statusCode: 415, message: `不是图片类型: ${contentType || 'unknown'}` })
  }

  const declared = Number(res.headers.get('content-length') || 0)
  if (declared && declared > maxBytes) {
    throw createError({ statusCode: 413, message: '图片超过 10MB 限制' })
  }

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > maxBytes) {
    throw createError({ statusCode: 413, message: '图片超过 10MB 限制' })
  }

  return { data: buf, contentType, finalUrl: res.url || url.toString() }
}
