// 文件夹列表内存缓存，避免每次导航回书架都被 text list 的 SQL.js 重查询阻塞
let cache: any[] | null = null
let cacheTime = 0
const TTL = 300_000 // 5 分钟 TTL，文件夹变更通过 invalidateFolderCache 主动失效

export function getCachedFolders(): any[] | null {
  if (cache && Date.now() - cacheTime < TTL) return cache
  return null
}

export function setCachedFolders(data: any[]): void {
  cache = data
  cacheTime = Date.now()
}

export function invalidateFolderCache(): void {
  cache = null
  cacheTime = 0
}
