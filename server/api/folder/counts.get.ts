import { queryAll } from '../../utils/db'
import { getCached, setCache } from '../../utils/cache'

export default defineEventHandler(async () => {
  const cacheKey = 'folder-counts'
  const cached = getCached(cacheKey)
  if (cached) return cached

  const rows = await queryAll(
    'SELECT folder, COUNT(*) as count FROM texts GROUP BY folder'
  )
  const counts: Record<string, number> = {}
  for (const row of rows) {
    counts[row.folder as string] = row.count as number
  }

  setCache(cacheKey, counts, 30_000)
  return counts
})
