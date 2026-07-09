import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

/** 非阻塞执行 shell 命令 */
function runCmd(cmd: string, timeout = 30000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr }))
      else resolve({ stdout, stderr })
    })
  })
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ url: string }>(event)
  if (!body?.url?.trim()) throw createError({ statusCode: 400, message: '缺少 URL' })

  const url = body.url.trim()

  // 检测是否为 playlist
  const isPlaylist = url.includes('list=') || url.includes('/playlist/')
  if (!isPlaylist) {
    throw createError({ statusCode: 400, message: '不是有效的播放列表链接' })
  }

  // 检查 yt-dlp
  try {
    await runCmd('yt-dlp --version', 5000)
  } catch {
    throw createError({
      statusCode: 500,
      message: 'yt-dlp 未安装。请运行 pip install yt-dlp 安装后再试。',
    })
  }

  // 构建所有 cookie 尝试方案（全部尝试，不提前终止）
  const cookiesPath = path.resolve('server/data/youtube-cookies.txt')
  const cookieAttempts: Array<{ flag: string; label: string }> = []

  if (existsSync(cookiesPath)) {
    cookieAttempts.push({ flag: `--cookies "${cookiesPath}"`, label: 'cookies 文件' })
  }

  // 浏览器 cookie 和文件 cookie 独立尝试，互不排斥
  cookieAttempts.push(
    { flag: '--cookies-from-browser edge', label: 'Edge 浏览器' },
    { flag: '--cookies-from-browser chrome', label: 'Chrome 浏览器' },
    { flag: '--cookies-from-browser firefox', label: 'Firefox 浏览器' },
  )

  // 无 cookie 兜底
  cookieAttempts.push({ flag: '', label: '无认证' })

  const errors: string[] = []

  for (const attempt of cookieAttempts) {
    try {
      const cmd = `yt-dlp --flat-playlist --dump-json --no-warnings --ignore-no-formats-error ${attempt.flag} "${url}"`
      const result = await runCmd(cmd, 30000)

      const lines = result.stdout.trim().split('\n').filter(Boolean)
      if (lines.length === 0) {
        errors.push(`${attempt.label}: 播放列表为空`)
        continue
      }

      const videos = lines.map(line => {
        try {
          const item = JSON.parse(line)
          return {
            id: item.id,
            title: item.title || '未命名',
            url: item.url || item.webpage_url || `https://www.youtube.com/watch?v=${item.id}`,
          }
        } catch {
          return null
        }
      }).filter(Boolean) as Array<{ id: string; title: string; url: string }>

      if (videos.length === 0) {
        errors.push(`${attempt.label}: 未解析到视频条目`)
        continue
      }

      // 提取播放列表标题
      let playlistTitle = ''
      try {
        const first = JSON.parse(lines[0])
        playlistTitle = first.playlist_title || first.playlist || ''
      } catch {}

      return {
        playlistTitle: playlistTitle || '播放列表',
        totalCount: videos.length,
        videos,
      }
    } catch (e: any) {
      const msg = e.stderr?.slice(0, 300) || e.message?.slice(0, 300) || `exit code ${e.code}`
      errors.push(`${attempt.label}: ${msg}`)
    }
  }

  // 所有尝试均失败，给出明确指引
  const errorSummary = errors.join('\n')
  const isAuthIssue = errorSummary.includes('403') || errorSummary.includes('Sign in') || errorSummary.includes('login')

  let helpMsg = `获取播放列表失败，所有认证方式均未通过：\n${errorSummary.slice(0, 400)}`

  if (isAuthIssue) {
    helpMsg += '\n\nYouTube 要求登录认证。解决方法：\n'
    helpMsg += '1. 在浏览器中登录 YouTube\n'
    helpMsg += '2. 使用浏览器扩展导出 cookies 为 Netscape 格式\n'
    helpMsg += '3. 保存到 server/data/youtube-cookies.txt\n'
    helpMsg += '4. 重试导入'
  } else {
    helpMsg += '\n\n请检查：yt-dlp 是否为最新版（pip install -U yt-dlp）、链接是否有效、网络是否正常。'
  }

  throw createError({ statusCode: 502, message: helpMsg })
})
