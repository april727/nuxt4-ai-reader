import { queryAll } from '../../utils/db'

export default defineEventHandler(async () => {
  // 一次性查询所有文件夹的文章数量
  const rows = await queryAll(
    'SELECT folder, COUNT(*) as count FROM texts GROUP BY folder'
  )
  const counts: Record<string, number> = {}
  for (const row of rows) {
    counts[row.folder as string] = row.count as number
  }

  return counts
})
