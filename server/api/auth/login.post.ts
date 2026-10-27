import { queryOne, runQuery } from '../../utils/db'
import { authToken, loginPage, redirectHtml } from '../../utils/loginPage'

export default defineEventHandler(async (event) => {
  // 尝试从 form POST 或 JSON 读取密码
  let password = ''
  try {
    const body = await readBody(event)
    password = body?.password || ''
  } catch {
    password = getQuery(event).password as string || ''
  }

  const correct = process.env['SITE_PASSWORD']

  if (!correct || !password || password !== correct) {
    setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    setResponseStatus(event, 401)
    return loginPage('密码错误')
  }

  // 正确 → 设置长期 cookie（180 天免登录）
  const token = authToken()
  setCookie(event, 'auth_token', token, {
    maxAge: 180 * 24 * 60 * 60,
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
  })

  // 保留登录记录：时间 / IP / 设备
  try {
    const ip = (getRequestHeader(event, 'x-forwarded-for') || '').split(',')[0].trim()
      || getRequestIP(event, { xForwardedFor: true })
      || ''
    const ua = getRequestHeader(event, 'user-agent') || ''
    await runQuery(
      'INSERT INTO auth_logs (id, time, ip, ua, ok) VALUES (?,?,?,?,1)',
      [`al_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, new Date().toISOString(), ip, ua.slice(0, 200)],
    )
  } catch {
    // 记录失败不影响登录
  }

  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  return redirectHtml('/')
})
