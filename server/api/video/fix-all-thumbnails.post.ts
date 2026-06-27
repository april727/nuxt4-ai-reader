import { execSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { queryAll, runQuery } from '../../utils/db'
import { getThumbsDir, ensureDir, resolveFilePath, FILES_ROOT, LEGACY_UPLOADS } from '../../utils/storage'

export default defineEventHandler(async () => {
  const rows = await queryAll("SELECT id, filePath, folder, videoMeta FROM texts WHERE source IN ('video_file','audio_file')")

  // 检查 ffmpeg
  let hasFfmpeg = false
  try { execSync('ffmpeg -version', { encoding: 'utf-8', timeout: 5000 }); hasFfmpeg = true } catch {}

  let fixed = 0
  let skipped = 0
  let errors: string[] = []

  for (const row of rows) {
    const folderId = row.folder || 'default'
    let meta: any = {}
    try { meta = JSON.parse(row.videoMeta || '{}') } catch {}

    // 已有缩略图且文件存在 → 跳过
    if (meta.thumbnail) {
      const thumbPath = resolveFilePath(meta.thumbnail)
      if (existsSync(thumbPath)) { skipped++; continue }
    }

    if (!hasFfmpeg) {
      errors.push(`${row.id}: ffmpeg 未安装`)
      continue
    }

    // 查找视频文件
    let videoFile = ''
    const fp = row.filePath || ''
    if (fp) {
      const r = resolveFilePath(fp)
      if (existsSync(r)) videoFile = r
    }

    // 回退搜索
    if (!videoFile) {
      try {
        if (existsSync(LEGACY_UPLOADS)) {
          for (const f of readdirSync(LEGACY_UPLOADS)) {
            if ((f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mov')) && existsSync(path.join(LEGACY_UPLOADS, f))) {
              videoFile = path.join(LEGACY_UPLOADS, f)
              break
            }
          }
        }
      } catch {}
    }

    if (!videoFile && existsSync(FILES_ROOT)) {
      try {
        const contentDir = path.join(FILES_ROOT, folderId, row.id)
        if (existsSync(contentDir)) {
          for (const entry of readdirSync(contentDir)) {
            if (entry.startsWith('source.')) {
              videoFile = path.join(contentDir, entry)
              break
            }
          }
        }
      } catch {}
    }

    if (!videoFile) {
      errors.push(`${row.id}: 未找到视频文件`)
      continue
    }

    // ffmpeg 截帧
    try {
      const thumbDir = getThumbsDir(folderId, row.id)
      ensureDir(thumbDir)
      const destPath = path.join(thumbDir, 'cover.jpg')

      execSync(
        `ffmpeg -ss 15 -i "${videoFile}" -vframes 1 -q:v 3 -y "${destPath}"`,
        { encoding: 'utf-8', timeout: 15000, stdio: 'pipe' }
      )

      if (existsSync(destPath)) {
        meta.thumbnail = `${folderId}/${row.id}/thumbs/cover.jpg`
        await runQuery('UPDATE texts SET videoMeta=? WHERE id=?', [JSON.stringify(meta), row.id])
        fixed++
      }
    } catch {
      errors.push(`${row.id}: ffmpeg 截帧失败`)
    }
  }

  return {
    ok: true,
    total: rows.length,
    fixed,
    skipped,
    errors: errors.slice(0, 20),
  }
})
