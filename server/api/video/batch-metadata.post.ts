import { exec } from 'node:child_process'
import { existsSync, mkdirSync, createWriteStream, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { get } from 'node:https'
import { get as httpGet } from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { getDb, saveDb } from '../../utils/db'
import { batchProgress } from '../../utils/batch-state'
import { parseSubtitles, secondsToTimeStr } from '../../utils/srt'
import { subtitlesToText } from '../../utils/subtitle'
import type { SubtitleCue, VideoMeta } from '#shared/types'

const UPLOADS_DIR = path.resolve('server/data/uploads')

/** 非阻塞执行 shell 命令 */
function runCmd(cmd: string, timeout = 90000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr }))
      else resolve({ stdout, stderr })
    })
  })
}

/** 下载缩略图到本地 */
function downloadThumbnail(imageUrl: string, destName: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!imageUrl || !imageUrl.startsWith('http')) return resolve(null)
    const extMatch = imageUrl.match(/\.(jpg|jpeg|webp|png)(\?|$)/i)
    const ext = extMatch?.[1] || 'jpg'
    const filename = `thumb_${destName}.${ext}`
    const filePath = path.join(UPLOADS_DIR, filename)
    if (existsSync(filePath)) return resolve(filename)

    if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true })

    const fetcher = imageUrl.startsWith('https') ? get : httpGet
    fetcher(imageUrl, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location
        if (redirectUrl) return resolve(downloadThumbnail(redirectUrl, destName))
        return resolve(null)
      }
      if (res.statusCode !== 200) return resolve(null)
      const file = createWriteStream(filePath)
      res.pipe(file)
      file.on('finish', () => resolve(filename))
      file.on('error', () => resolve(null))
    }).on('error', () => resolve(null))
  })
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids: string[] }>(event)
  if (!body?.ids?.length) throw createError({ statusCode: 400, message: '缺少视频 ID 列表' })

  const batchId = 'batch_' + Date.now()
  batchProgress.set(batchId, { total: body.ids.length, current: 0, errors: [], done: false })

  // 后台非阻塞执行
  runBatch(batchId, body.ids).catch(err => {
    console.error('[batch-metadata] 后台处理异常:', err.message)
  })

  return { batchId, total: body.ids.length }
})

// ============================================================
//  后台批量处理：元数据 + 字幕提取
// ============================================================
async function runBatch(batchId: string, ids: string[]) {
  const db = await getDb()
  const getMetaStmt = db.prepare('SELECT videoMeta,source,title,videoSubtitles FROM texts WHERE id=?')

  for (const videoId of ids) {
    try {
      getMetaStmt.bind([videoId])
      let row: any = null
      if (getMetaStmt.step()) row = getMetaStmt.getAsObject()
      getMetaStmt.reset()

      if (!row) {
        incProgress(batchId, '记录不存在')
        continue
      }

      const metaStr: string = row.videoMeta || ''
      if (!metaStr) {
        incProgress(batchId, '无 videoMeta')
        continue
      }

      let videoMeta: VideoMeta
      try { videoMeta = JSON.parse(metaStr) } catch {
        incProgress(batchId, 'videoMeta 解析失败')
        continue
      }

      if (!videoMeta.url) {
        incProgress(batchId, '无视频 URL')
        continue
      }

      // 检查是否已有字幕，跳过
      let hasSubs = false
      try {
        const existingSubs = JSON.parse(row.videoSubtitles || '[]')
        hasSubs = existingSubs.length > 0
      } catch {}

      const url = videoMeta.url
      const isBilibili = videoMeta.type === 'bilibili'
      const cookiesPath = path.resolve('server/data/youtube-cookies.txt')

      let fetchedTitle = row.title || ''
      let fetchedDuration = videoMeta.duration || 0
      let fetchedThumbnail = videoMeta.thumbnail || ''

      // ── 1. 获取元数据 ──
      let metaResult = ''
      const cookieAttempts: string[] = []
      if (existsSync(cookiesPath)) {
        cookieAttempts.push(`--cookies "${cookiesPath}"`)
      } else {
        cookieAttempts.push('--cookies-from-browser edge', '--cookies-from-browser chrome', '--cookies-from-browser firefox')
      }
      cookieAttempts.push('')

      for (const cookieFlag of cookieAttempts) {
        if (metaResult) break
        try {
          const cmd = `yt-dlp --dump-json --no-warnings --ignore-no-formats-error ${cookieFlag} "${url}"`
          const res = await runCmd(cmd, 30000)
          metaResult = res.stdout
        } catch {}
      }

      if (metaResult) {
        try {
          const meta = JSON.parse(metaResult.trim().split('\n')[0])
          fetchedTitle = meta.title || fetchedTitle
          fetchedDuration = meta.duration || fetchedDuration
          fetchedThumbnail = meta.thumbnail || fetchedThumbnail
        } catch {}
      }

      // 下载缩略图
      let localThumbnail = ''
      if (fetchedThumbnail) {
        localThumbnail = await downloadThumbnail(fetchedThumbnail, videoId) || ''
      }

      // ── 2. 提取字幕（如尚未有） ──
      let subtitles: SubtitleCue[] = []
      if (!hasSubs) {
        const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'yt-subs-'))
        try {
          for (const cookieFlag of cookieAttempts) {
            if (subtitles.length > 0) break

            if (isBilibili) {
              try {
                await runCmd(
                  `yt-dlp --skip-download --write-auto-subs --sub-langs "en" --sub-format vtt --convert-subs srt -o "%(id)s" -P "${tmpDir}" --no-warnings "${url}"`,
                )
              } catch {}
              subtitles = checkSubFiles(tmpDir)
            } else {
              for (const lang of ['en', '']) {
                if (subtitles.length > 0) break
                const langFlag = lang ? `--sub-langs "${lang}"` : ''
                try {
                  await runCmd(
                    `yt-dlp --skip-download --write-auto-subs ${langFlag} --sub-format vtt --convert-subs srt ${cookieFlag} -o "%(id)s" -P "${tmpDir}" --no-warnings "${url}"`,
                    90000
                  )
                } catch {}
                subtitles = checkSubFiles(tmpDir)
              }
            }
          }
        } finally {
          try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
        }
      }

      // ── 3. 更新 DB ──
      const updatedMeta: VideoMeta = {
        ...videoMeta,
        duration: fetchedDuration || videoMeta.duration || 0,
        thumbnail: localThumbnail || fetchedThumbnail || videoMeta.thumbnail || '',
      }

      if (subtitles.length > 0) {
        const text = subtitlesToText(subtitles)
        const segments = subtitles.map((c, idx) => ({
          id: `p-${idx}`, index: idx, text: c.text, start: c.start, end: c.end,
        }))
        const excerpt = text.replace(/\s+/g, ' ').trim().slice(0, 150)

        db.run(
          `UPDATE texts SET title=?, videoMeta=?, videoSubtitles=?, text=?, segments=?, excerpt=? WHERE id=?`,
          [
            fetchedTitle,
            JSON.stringify(updatedMeta),
            JSON.stringify(subtitles),
            text.slice(0, 100000),
            JSON.stringify(segments),
            excerpt,
            videoId,
          ]
        )
      } else {
        db.run('UPDATE texts SET title=?, videoMeta=? WHERE id=?', [
          fetchedTitle, JSON.stringify(updatedMeta), videoId,
        ])
      }
      await saveDb()
    } catch (e: any) {
      incProgress(batchId, e.message?.slice(0, 120) || '未知错误')
    }
  }

  const state = batchProgress.get(batchId)
  if (state) state.done = true
  console.log(`[batch-metadata] ${batchId} 完成: ${ids.length} 个视频`)
}

function checkSubFiles(tmpDir: string): SubtitleCue[] {
  let files: string[] = []
  try { files = readdirSync(tmpDir) } catch { return [] }
  const subFile = files.find(f => /\.(srt|vtt)$/i.test(f))
  if (subFile) {
    const content = readFileSync(path.join(tmpDir, subFile), 'utf-8')
    return parseSubtitles(content)
  }
  return []
}

function incProgress(batchId: string, error?: string) {
  const state = batchProgress.get(batchId)
  if (!state) return
  state.current++
  if (error) state.errors.push(error)
}
