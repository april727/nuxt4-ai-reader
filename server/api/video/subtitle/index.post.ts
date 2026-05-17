import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { SubtitleCue } from '#shared/types'
import { parseSubtitles, secondsToTimeStr } from '../../../utils/srt'
import { subtitlesToText } from '../../../utils/subtitle'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ url: string }>(event)
  if (!body?.url?.trim()) throw createError({ statusCode: 400, message: '缺少 URL' })

  const url = body.url.trim()

  // 检查 yt-dlp 是否已安装
  try {
    execSync('yt-dlp --version', { encoding: 'utf-8', timeout: 5000 })
  } catch {
    throw createError({
      statusCode: 500,
      message: '需要安装 yt-dlp\n请运行: pip install yt-dlp\n或从 https://github.com/yt-dlp/yt-dlp/releases 下载',
    })
  }

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'yt-subs-'))

  try {
    // ---- 第 1 步：获取视频元数据 ----
    let meta: any
    try {
      const metaJson = execSync(
        `yt-dlp --dump-json --no-warnings --flat-playlist "${url}"`,
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 30000 }
      )
      meta = JSON.parse(metaJson.trim().split('\n')[0])
    } catch (e: any) {
      if (e.statusCode) throw e
      throw new Error(`获取视频信息失败: ${e.stderr?.slice(0, 200) || e.message}`)
    }

    const title = meta?.title || '未命名视频'
    const duration = meta?.duration || 0
    const thumbnail = meta?.thumbnail || ''
    const extractor = meta?.extractor?.toLowerCase() || ''
    const detectedType = extractor.includes('bilibili') ? 'bilibili' : 'youtube'

    // ---- 第 2 步：下载字幕（多层兜底） ----
    let subtitles: SubtitleCue[] = []

    // 尝试顺序：cookies 文件（优先，绕过浏览器锁）→ 无 cookies
    // 只在 cookies 文件不存在时才尝试从浏览器读取
    const cookiesPath = path.resolve('server/data/youtube-cookies.txt').replace(/\\/g, '/')
    const cookieAttempts: Array<{ name: string; flag: string }> = []
    if (existsSync(cookiesPath)) {
      cookieAttempts.push({ name: 'file', flag: `--cookies "${cookiesPath}"` })
    } else {
      cookieAttempts.push(
        { name: 'edge', flag: '--cookies-from-browser edge' },
        { name: 'chrome', flag: '--cookies-from-browser chrome' },
        { name: 'firefox', flag: '--cookies-from-browser firefox' },
      )
    }
    cookieAttempts.push({ name: 'none', flag: '' })

    for (const cookies of cookieAttempts) {
      if (subtitles.length > 0) break

      for (const lang of ['en', '']) {
        if (subtitles.length > 0) break
        const langFlag = lang ? `--sub-langs "${lang}"` : ''

        try {
          execSync(
            `yt-dlp --skip-download --write-auto-subs ${langFlag} --sub-format vtt --convert-subs srt ${cookies.flag} -o "%(id)s" -P "${tmpDir}" --no-warnings "${url}"`,
            { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 90000, stdio: ['pipe', 'pipe', 'pipe'] }
          )
        } catch (err: any) {
          const stderr = err.stderr?.toString().slice(0, 200) || ''
          if (cookies.name !== 'none') {
            console.warn(`[subtitle] cookies (${cookies.name}) 失败: ${stderr || err.message}`)
          } else {
            console.error(`[subtitle] 无 cookies 失败: ${stderr || err.message}`)
          }
        }

        const files = readdirSync(tmpDir)
        const subFile = files.find(f => /\.(srt|vtt)$/i.test(f))
        if (subFile) {
          const content = readFileSync(path.join(tmpDir, subFile), 'utf-8')
          subtitles = parseSubtitles(content)
        }
      }
    }

    if (subtitles.length === 0) {
      throw new Error('该视频没有可用字幕（自动字幕也未开启）')
    }

    const text = subtitlesToText(subtitles)

    return {
      title,
      subtitles,
      text,
      duration,
      durationFormatted: secondsToTimeStr(duration),
      thumbnail,
      type: detectedType,
    }
  } catch (e: any) {
    if (e.statusCode) throw e
    throw createError({ statusCode: 502, message: `字幕提取失败: ${e.message || '未知错误'}` })
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
})
