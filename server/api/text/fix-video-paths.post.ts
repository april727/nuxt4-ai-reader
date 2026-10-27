import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { queryAll, runQuery } from '../../utils/db'
import { FILES_ROOT, LEGACY_UPLOADS } from '../../utils/storage'

export default defineEventHandler(async () => {
  const rows = await queryAll("SELECT id,filePath,folder,source,videoMeta FROM texts WHERE source IN ('video_file','audio_file')")

  let fixed = 0
  let ok = 0

  for (const row of rows) {
    const fp = row.filePath || ''
    let meta: any = {}
    try { meta = JSON.parse(row.videoMeta || '{}') } catch {}

    // 检查当前 filePath 是否指向存在的文件
    const fileExists = fp && (
      existsSync(path.join(LEGACY_UPLOADS, fp)) ||
      (fp.includes('/') && existsSync(path.join(FILES_ROOT, fp))) ||
      existsSync(path.join(FILES_ROOT, fp))
    )

    if (fileExists) { ok++; continue }

    // filePath 不存在 → 在 files/ 中搜索
    const folderId = row.folder || 'default'
    const contentDir = path.join(FILES_ROOT, folderId, row.id)

    if (existsSync(contentDir)) {
      // 在 contentDir 中查找 source.* 文件
      try {
        const entries = readdirSync(contentDir)
        const sourceFile = entries.find((f: string) => f.startsWith('source.'))
        if (sourceFile) {
          const newPath = `${folderId}/${row.id}/${sourceFile}`
          const newUrl = `/api/file/${newPath}`

          await runQuery('UPDATE texts SET filePath=? WHERE id=?', [newPath, row.id])
          meta.url = newUrl
          await runQuery('UPDATE texts SET videoMeta=? WHERE id=?', [JSON.stringify(meta), row.id])
          fixed++
        }
      } catch {}
    }
  }

  return { ok: true, fixed, alreadyOk: ok, total: rows.length }
})
