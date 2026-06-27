import { execSync, exec } from 'node:child_process'
import { createWriteStream, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs'
import { get } from 'node:https'
import { get as httpGet } from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { queryOne, runQuery } from '../../../utils/db'
import { safeParse } from '../../../utils/subtitle'
import { parseSubtitles, secondsToTimeStr } from '../../../utils/srt'
import { subtitlesToText } from '../../../utils/subtitle'
import { getThumbsDir, ensureDir } from '../../../utils/storage'
import type { SubtitleCue, VideoMeta } from '#shared/types'

/** 非阻塞执行 shell 命令 */
function runCmd(cmd: string, timeout = 90000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr }))
      else resolve({ stdout, stderr })
    })
  })
}

// 防止同一视频重复提取
const inProgress = new Set<string>()

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: '缺少视频 ID' })

  // 从 DB 获取视频记录
  const row = await queryOne('SELECT title,videoMeta,videoSubtitles,folder FROM texts WHERE id=?', [id])
  if (!row) throw createError({ statusCode: 404, message: '视频不存在' })

  // 已有字幕则跳过
  const existingSubs = safeParse<SubtitleCue[]>(row.videoSubtitles, [])
  if (existingSubs.length > 0) {
    return { status: 'done', message: '字幕已存在', subtitleCount: existingSubs.length }
  }

  // 已在后台提取中
  if (inProgress.has(id)) {
    return { status: 'processing', message: '字幕正在后台提取' }
  }

  const videoMeta = safeParse<VideoMeta | null>(row.videoMeta, null)
  if (!videoMeta?.url) throw createError({ statusCode: 400, message: '视频 URL 不存在' })

  const url = videoMeta.url
  const isBilibili = videoMeta.type === 'bilibili'

  // 检查 yt-dlp
  try {
    execSync('yt-dlp --version', { encoding: 'utf-8', timeout: 5000 })
  } catch {
    throw createError({ statusCode: 500, message: 'yt-dlp 未安装' })
  }

  // 标记为进行中
  inProgress.add(id)

  // === 后台异步执行，不阻塞响应 ===
  runExtraction(id, url, isBilibili, row)
    .catch(err => console.error(`[extract] ${id} 失败:`, err.message))
    .finally(() => {
      inProgress.delete(id)
    })

  return { status: 'processing', message: '字幕正在后台提取' }
})

// ============================================================
//  下载缩略图到本地（避免每次书架打开都从 YouTube CDN 加载）
// ============================================================
/** 下载缩略图到指定内容的 thumbs/ 目录，返回相对路径 */
function downloadThumbnail(imageUrl: string, folderId: string, contentId: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!imageUrl || !imageUrl.startsWith('http')) return resolve(null)
    const extMatch = imageUrl.match(/\.(jpg|jpeg|webp|png)(\?|$)/i)
    const ext = extMatch?.[1] || 'jpg'
    const dir = getThumbsDir(folderId, contentId)
    ensureDir(dir)
    const filename = `cover.${ext}`
    const filePath = path.join(dir, filename)
    const relative = `${folderId}/${contentId}/thumbs/${filename}`

    if (existsSync(filePath)) return resolve(relative)

    const fetcher = imageUrl.startsWith('https') ? get : httpGet
    fetcher(imageUrl, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location
        if (redirectUrl) return resolve(downloadThumbnail(redirectUrl, folderId, contentId))
        return resolve(null)
      }
      if (res.statusCode !== 200) return resolve(null)
      const file = createWriteStream(filePath)
      res.pipe(file)
      file.on('finish', () => resolve(relative))
      file.on('error', () => resolve(null))
    }).on('error', () => resolve(null))
  })
}

// ============================================================
//  后台提取逻辑（异步非阻塞）
//  元数据和字幕独立获取：字幕失败不影响标题和封面
// ============================================================
async function runExtraction(id: string, url: string, isBilibili: boolean, row: any) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'yt-subs-'))
  let subtitles: SubtitleCue[] = []
  let fetchedTitle = ''
  let fetchedDuration = 0
  let fetchedThumbnail = ''

  try {
    // Cookie 尝试链
    const cookiesPath = path.resolve('server/data/youtube-cookies.txt')
    const cookieAttempts: Array<{ name: string; cmdFlag: string }> = []
    if (existsSync(cookiesPath)) {
      cookieAttempts.push({ name: 'file', cmdFlag: `--cookies "${cookiesPath}"` })
    } else {
      cookieAttempts.push(
        { name: 'edge', cmdFlag: '--cookies-from-browser edge' },
        { name: 'chrome', cmdFlag: '--cookies-from-browser chrome' },
        { name: 'firefox', cmdFlag: '--cookies-from-browser firefox' },
      )
    }
    cookieAttempts.push({ name: 'none', cmdFlag: '' })

    // ── 元数据获取（独立于字幕，始终执行） ──
    try {
      const metaResult = await runCmd(
        `yt-dlp --dump-json --no-warnings --ignore-no-formats-error ${existsSync(cookiesPath) ? `--cookies "${cookiesPath}"` : ''} "${url}"`,
        30000
      )
      const meta = JSON.parse(metaResult.stdout.trim().split('\n')[0])
      fetchedTitle = meta.title || ''
      fetchedDuration = meta.duration || 0
      fetchedThumbnail = meta.thumbnail || ''
      console.log(`[extract] ${id} 元数据获取成功: "${fetchedTitle}"`)
    } catch (e: any) {
      console.warn(`[extract] ${id} 元数据获取失败:`, e?.message || '')
    }

    // ── 字幕下载（可能失败，不影响元数据） ──
    for (const cookies of cookieAttempts) {
      if (subtitles.length > 0) break

      if (isBilibili) {
        try {
          await runCmd(
            `yt-dlp --skip-download --write-auto-subs --sub-langs "en" --sub-format vtt --convert-subs srt -o "%(id)s" -P "${tmpDir}" --no-warnings "${url}"`,
          )
        } catch { /* 忽略 */ }
        checkFiles()
      } else {
        for (const lang of ['en', '']) {
          if (subtitles.length > 0) break
          const langFlag = lang ? `--sub-langs "${lang}"` : ''
          try {
            await runCmd(
              `yt-dlp --skip-download --write-auto-subs ${langFlag} --sub-format vtt --convert-subs srt ${cookies.cmdFlag} -o "%(id)s" -P "${tmpDir}" --no-warnings "${url}"`,
              90000
            )
          } catch { /* 忽略 */ }
          checkFiles()
        }
      }
    }

    function checkFiles() {
      let files: string[] = []
      try { files = readdirSync(tmpDir) } catch { return }
      const subFile = files.find(f => /\.(srt|vtt)$/i.test(f))
      if (subFile) {
        const content = readFileSync(path.join(tmpDir, subFile), 'utf-8')
        subtitles = parseSubtitles(content)
      }
    }

    if (subtitles.length === 0) {
      console.warn(`[extract] ${id} 字幕获取失败（视频可能未开启自动字幕），但元数据已获取`)
    }

    // 下载缩略图到本地
    let localThumbnail = ''
    if (fetchedThumbnail) {
      localThumbnail = await downloadThumbnail(fetchedThumbnail, row.folder || 'default', id) || ''
    }

    // ── 更新 DB ──
    // 写入前重新检查：此期间用户可能已手动上传字幕，不应覆盖
    const checkRow = await queryOne('SELECT videoSubtitles FROM texts WHERE id=?', [id])
    let currentSubs: SubtitleCue[] = []
    if (checkRow) {
      currentSubs = safeParse<SubtitleCue[]>(checkRow.videoSubtitles, [])
    }

    const oldMeta = safeParse<VideoMeta | null>(row.videoMeta, null)
    const updatedMeta: VideoMeta = {
      url: oldMeta?.url || '',
      type: oldMeta?.type || 'youtube',
      duration: fetchedDuration || oldMeta?.duration || 0,
      thumbnail: localThumbnail || fetchedThumbnail || oldMeta?.thumbnail || '',
      originalFileName: oldMeta?.originalFileName || '',
    }

    if (currentSubs.length > 0) {
      // 已有字幕（手动上传或之前的提取），只更新元数据，保护现有字幕不被覆盖
      await runQuery(
        `UPDATE texts SET title=?, videoMeta=? WHERE id=?`,
        [fetchedTitle || row.title, JSON.stringify(updatedMeta), id]
      )
      console.log(`[extract] ${id} 字幕已存在（${currentSubs.length} 条），仅更新元数据，标题="${fetchedTitle || row.title}"`)
    } else {
      // 没有字幕，正常写入
      const text = subtitles.length > 0 ? subtitlesToText(subtitles) : ''
      const segments = subtitles.map((c, idx) => ({
        id: `p-${idx}`, index: idx, text: c.text, start: c.start, end: c.end,
      }))
      const excerpt = text.replace(/\s+/g, ' ').trim().slice(0, 150)

      await runQuery(
        `UPDATE texts SET text=?, title=?, videoSubtitles=?, segments=?, excerpt=?, videoMeta=?, filePath=? WHERE id=?`,
        [
          text.slice(0, 100000),
          fetchedTitle || row.title,
          JSON.stringify(subtitles),
          JSON.stringify(segments),
          excerpt,
          JSON.stringify(updatedMeta),
          '',
          id,
        ]
      )
      console.log(`[extract] ${id} 完成: ${subtitles.length} 条字幕, 标题="${fetchedTitle || row.title}"`)
    }
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}
