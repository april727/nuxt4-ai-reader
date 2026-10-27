/**
 * 简易内存缓存（用于加速 API 响应）
 * TTL 10 秒，快速连续刷新时命中
 */
const store = new Map<string, { data: any; expires: number }>()

export function getCached(key: string): any | undefined {
  const entry = store.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expires) { store.delete(key); return undefined }
  return entry.data
}

export function setCache(key: string, data: any, ttlMs = 10_000) {
  store.set(key, { data, expires: Date.now() + ttlMs })
}

export function clearCache() {
  store.clear()
}
