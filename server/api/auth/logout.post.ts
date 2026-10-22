import { redirectHtml } from '../../utils/loginPage'

/** POST /api/auth/logout → 清除登录 cookie 并回到登录页 */
export default defineEventHandler((event) => {
  setCookie(event, 'auth_token', '', { maxAge: 0, httpOnly: true, path: '/' })
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  return redirectHtml('/api/auth/login', '已退出登录')
})
