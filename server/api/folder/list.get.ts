import { queryAll, runQuery } from '../../utils/db'
import { getCachedFolders, setCachedFolders } from '../../utils/folderCache'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const parent = (query.parent as string) || ''

  // 顶层文件夹列表（无 parent 参数）走缓存，因为变化频率低
  if (!parent) {
    const cached = getCachedFolders()
    if (cached) return cached
  }

  // 兼容旧表无 parent 列
  let hasParent = true
  try { await queryAll("SELECT parent FROM folders LIMIT 1") } catch { hasParent = false }

  let rows: any[]
  if (hasParent) {
    if (parent) {
      rows = await queryAll('SELECT * FROM folders WHERE parent=? ORDER BY createdAt', [parent])
    } else {
      rows = await queryAll("SELECT * FROM folders WHERE (parent='' OR parent IS NULL) ORDER BY createdAt")
    }
  } else {
    rows = await queryAll('SELECT * FROM folders ORDER BY createdAt')
  }

  if (rows.length === 0 && !parent) {
    const id = 'default'
    await runQuery("INSERT OR IGNORE INTO folders VALUES (?,?,?,?)", [id, '默认文件夹', '', new Date().toISOString()])
    const result = [{ id, name: '默认文件夹', parent: '', createdAt: new Date().toISOString(), isPrivate: 0 }]
    setCachedFolders(result)
    return result
  }
  // 过滤掉 passwordHash，不暴露到前端
  const result = rows.map((r: any) => ({
    id: r.id, name: r.name, parent: r.parent || '', createdAt: r.createdAt,
    isPrivate: r.isPrivate === 1,
  }))
  if (!parent) setCachedFolders(result)
  return result
})
