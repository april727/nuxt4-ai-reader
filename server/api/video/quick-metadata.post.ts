import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ url: string }>(event)
  if (!body?.url?.trim()) throw createError({ statusCode: 400, message: '缺少 URL' })

  const url = body.url.trim()

  // 检查 yt-dlp
  const verCheck = spawnSync('yt-dlp', ['--version'], { encoding: 'utf-8', timeout: 5000 })
  if (verCheck.status !== 0) {
    throw createError({ statusCode: 500, message: 'yt-dlp 未安装' })
  }

  // 构建 cookie 尝试链
  const cookiesPath = path.resolve('server/data/youtube-cookies.txt')
  type CookieAttempt = { name: string; args: string[] }
  const cookieAttempts: CookieAttempt[] = []

  if (existsSync(cookiesPath)) {
    cookieAttempts.push({ name: 'file', args: ['--cookies', cookiesPath] })
  } else {
    cookieAttempts.push(
      { name: 'edge', args: ['--cookies-from-browser', 'edge'] },
      { name: 'chrome', args: ['--cookies-from-browser', 'chrome'] },
      { name: 'firefox', args: ['--cookies-from-browser', 'firefox'] },
    )
  }
  cookieAttempts.push({ name: 'none', args: [] })

  let lastError: any = null

  for (const cookies of cookieAttempts) {
    const cmdArgs = ['--dump-json', '--no-warnings', '--ignore-no-formats-error', ...cookies.args, url]
    const result = spawnSync('yt-dlp', cmdArgs, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
    })

    if (result.status === 0 && result.stdout) {
      try {
        const meta = JSON.parse(result.stdout.trim().split('\n')[0])
        const extractor = meta?.extractor?.toLowerCase() || ''

        return {
          title: meta?.title || '未命名视频',
          duration: meta?.duration || 0,
          thumbnail: meta?.thumbnail || '',
          type: extractor.includes('bilibili') ? 'bilibili' : 'youtube',
        }
      } catch {
        lastError = { message: 'Failed to parse metadata JSON' }
      }
    } else {
      // 真正失败才记录
      const stderr = result.stderr?.slice(0, 200) || ''
      lastError = { message: stderr || `exit code ${result.status}` }
      if (cookies.name !== 'none') {
        console.warn(`[quick-metadata] cookies (${cookies.name}) 失败: ${stderr || result.status}`)
      }
    }
  }

  throw createError({
    statusCode: 502,
    message: `获取视频信息失败: ${lastError?.message?.slice(0, 200) || '未知错误'}`,
  })
})
