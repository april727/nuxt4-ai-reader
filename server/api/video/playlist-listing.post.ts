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
    throw createError({ statusCode: 500, message: 'yt-dlp 未安装' })
  }

  // Cookie 尝试链
  const cookiesPath = path.resolve('server/data/youtube-cookies.txt')
  const cookieAttempts: string[] = []

  if (existsSync(cookiesPath)) {
    cookieAttempts.push(`--cookies "${cookiesPath}"`)
  } else {
    cookieAttempts.push('--cookies-from-browser edge', '--cookies-from-browser chrome', '--cookies-from-browser firefox')
  }
  cookieAttempts.push('')

  let lastError: any = null

  for (const cookieFlag of cookieAttempts) {
    try {
      const cmd = `yt-dlp --flat-playlist --dump-json --no-warnings --ignore-no-formats-error ${cookieFlag} "${url}"`
      const result = await runCmd(cmd, 30000)

      const lines = result.stdout.trim().split('\n').filter(Boolean)
      if (lines.length === 0) {
        lastError = { message: '播放列表为空' }
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

      // 第一行可能有 playlist 标题信息
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
      const stderr = e.stderr?.slice(0, 200) || e.message?.slice(0, 200) || ''
      lastError = { message: stderr || `exit code ${e.code}` }
    }
  }

  throw createError({
    statusCode: 502,
    message: `获取播放列表失败: ${lastError?.message?.slice(0, 200) || '未知错误'}`,
  })
})
