import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { queryOne } from '../../../utils/db'
import { resolveFilePath, FILES_ROOT, LEGACY_UPLOADS } from '../../../utils/storage'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400 })

  const row = await queryOne('SELECT * FROM texts WHERE id=?', [id])
  if (!row) throw createError({ statusCode: 404 })

  // 解码所有关键字段
  const videoMeta = (() => { try { return JSON.parse(row.videoMeta || '{}') } catch { return {} } })()
  const segments = (() => { try { return JSON.parse(row.segments || '[]') } catch { return [] } })()

  // 收集段落的图片引用
  const imageRefs: string[] = []
  for (const seg of segments) {
    if (seg.images?.length) imageRefs.push(...seg.images)
  }

  // 检查文件是否存在
  const fileChecks: Record<string, boolean> = {}
  const pathsToCheck = [
    row.filePath,
    videoMeta.thumbnail,
    row.filePath ? resolveFilePath(row.filePath) : null,
    videoMeta.thumbnail ? resolveFilePath(videoMeta.thumbnail) : null,
    ...imageRefs,
    ...imageRefs.map((r: string) => resolveFilePath(r)),
  ]

  for (const p of pathsToCheck) {
    if (!p) continue
    fileChecks[p] = existsSync(p)
  }

  // 列出 uploads/ 中可能相关的文件
  const relatedUploads: string[] = []
  try {
    if (existsSync(LEGACY_UPLOADS)) {
      const cleanId = id.replace('vid_', '').replace('txt_', '')
      for (const f of readdirSync(LEGACY_UPLOADS)) {
        if (f.includes(cleanId) || f.startsWith('vid_') || f.startsWith('thumb_')) {
          relatedUploads.push(f)
        }
      }
    }
  } catch {}

  // 列出 files/ 中匹配的目录
  const relatedFiles: string[] = []
  try {
    if (existsSync(FILES_ROOT)) {
      for (const folder of readdirSync(FILES_ROOT)) {
        const contentDir = path.join(FILES_ROOT, folder)
        if (!existsSync(contentDir)) continue
        try { if (!statSync(contentDir).isDirectory()) continue } catch { continue }
        const entries = readdirSync(contentDir)
        for (const entry of entries) {
          if (entry === id || entry.includes(id.replace('vid_', '').replace('txt_', ''))) {
            try {
              const subs = readdirSync(path.join(contentDir, entry))
              for (const s of subs) {
                const subPath = path.join(contentDir, entry, s)
                const st = statSync(subPath)
                if (st.isDirectory()) {
                  const items = readdirSync(subPath)
                  relatedFiles.push(`${folder}/${entry}/${s}/ [${items.join(', ')}]`)
                } else {
                  relatedFiles.push(`${folder}/${entry}/${s}`)
                }
              }
            } catch {}
          }
        }
      }
    }
  } catch {}

  return {
    id: row.id,
    source: row.source,
    folder: row.folder,
    filePath: row.filePath,
    videoMeta_url: videoMeta.url,
    videoMeta_thumbnail: videoMeta.thumbnail,
    imageRefs: imageRefs.length,
    fileChecks,
    relatedUploads: relatedUploads.slice(0, 10),
    relatedFiles: relatedFiles.slice(0, 10),
  }
})
