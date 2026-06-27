import { createWriteStream, existsSync } from 'node:fs'
import { get } from 'node:https'
import { get as httpGet } from 'node:http'
import path from 'node:path'
import { queryAll, runQuery } from '../../utils/db'
import { getThumbsDir, ensureDir } from '../../utils/storage'

function downloadImage(imageUrl: string, destPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!imageUrl.startsWith('http')) return resolve(false)
    const fetcher = imageUrl.startsWith('https') ? get : httpGet
    const req = fetcher(imageUrl, { timeout: 15000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirect = res.headers.location
        if (redirect) return resolve(downloadImage(redirect, destPath))
        return resolve(false)
      }
      if (res.statusCode !== 200) return resolve(false)
      const file = createWriteStream(destPath)
      res.pipe(file)
      file.on('finish', () => resolve(true))
      file.on('error', () => resolve(false))
    })
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.on('error', () => resolve(false))
  })
}

export default defineEventHandler(async () => {
  const rows = await queryAll("SELECT id, folder, videoMeta FROM texts WHERE source IN ('youtube','bilibili')")

  let downloaded = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    let meta: any = {}
    try { meta = JSON.parse(row.videoMeta || '{}') } catch {}
    const thumbUrl = meta.thumbnail || ''

    // 只处理远程 URL
    if (!thumbUrl || !thumbUrl.startsWith('http')) { skipped++; continue }

    const folderId = row.folder || 'default'
    const ext = thumbUrl.match(/\.(jpg|jpeg|webp|png)(\?|$)/i)?.[1] || 'jpg'
    const thumbDir = getThumbsDir(folderId, row.id)
    ensureDir(thumbDir)
    const destPath = path.join(thumbDir, `cover.${ext}`)

    if (existsSync(destPath)) { skipped++; continue }

    const ok = await downloadImage(thumbUrl, destPath)
    if (ok) {
      meta.thumbnail = `${folderId}/${row.id}/thumbs/cover.${ext}`
      await runQuery('UPDATE texts SET videoMeta=? WHERE id=?', [JSON.stringify(meta), row.id])
      downloaded++
    } else {
      failed++
    }
  }

  return { ok: true, total: rows.length, downloaded, skipped, failed }
})
