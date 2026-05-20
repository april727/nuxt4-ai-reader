import { execSync, exec } from 'node:child_process'
import { createWriteStream, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs'
import { get } from 'node:https'
import { get as httpGet } from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { getDb, saveDb } from '../../../utils/db'
import { safeParse } from '../../../utils/subtitle'
import { parseSubtitles, secondsToTimeStr } from '../../../utils/srt'
import { subtitlesToText } from '../../../utils/subtitle'
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
  const db = await getDb()
  const stmt = db.prepare('SELECT title,videoMeta,videoSubtitles FROM texts WHERE id=?')
  stmt.bind([id])
  let row: any = null
  if (stmt.step()) row = stmt.getAsObject()
  stmt.free()
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
const UPLOADS_DIR = path.resolve('server/data/uploads')

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

// ============================================================
//  后台提取逻辑（异步非阻塞）
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

    // 下载字幕
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
      throw new Error('该视频没有可用字幕（自动字幕也未开启）')
    }

    // 获取元数据
    try {
      const metaResult = await runCmd(
        `yt-dlp --dump-json --no-warnings --ignore-no-formats-error --cookies "${cookiesPath}" "${url}"`,
        30000
      )
      const meta = JSON.parse(metaResult.stdout.trim().split('\n')[0])
      fetchedTitle = meta.title || ''
      fetchedDuration = meta.duration || 0
      fetchedThumbnail = meta.thumbnail || ''
    } catch { /* 元数据不是必须的 */ }

    // 下载缩略图到本地（避免每次书架打开都从 YouTube CDN 重新加载）
    let localThumbnail = ''
    if (fetchedThumbnail) {
      localThumbnail = await downloadThumbnail(fetchedThumbnail, id) || ''
    }

    // 更新 DB
    const db = await getDb()
    const text = subtitlesToText(subtitles)
    const segments = subtitles.map((c, idx) => ({
      id: `p-${idx}`, index: idx, text: c.text, start: c.start, end: c.end,
    }))
    const excerpt = text.replace(/\s+/g, ' ').trim().slice(0, 150)
    const videoMeta = safeParse<VideoMeta | null>(row.videoMeta, null)
    const updatedMeta: VideoMeta = {
      url: videoMeta?.url || '',
      type: videoMeta?.type || 'youtube',
      duration: fetchedDuration || videoMeta?.duration || 0,
      thumbnail: localThumbnail || fetchedThumbnail || videoMeta?.thumbnail || '',
      originalFileName: videoMeta?.originalFileName || '',
    }

    db.run(
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
    await saveDb()
    console.log(`[extract] ${id} 完成: ${subtitles.length} 条字幕`)
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}
