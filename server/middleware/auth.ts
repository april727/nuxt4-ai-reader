import { authToken } from '../utils/loginPage'

/**
 * 全站密码保护
 *
 * - 未设置 SITE_PASSWORD → 不拦截
 * - 已登录（auth_token cookie = SHA-256(密码)）→ 放行
 * - 未登录：页面请求跳登录页，API 请求返回 401
 * - 登录入口 /api/auth/login、登出 /api/auth/logout、静态资源不拦截
 */
const EXEMPT = ['/api/auth/login', '/api/auth/logout', '/_nuxt/', '/__nuxt', '/favicon', '/robots.txt', '/icon', '/apple-touch']

export default defineEventHandler((event) => {
  const password = process.env['SITE_PASSWORD']
  if (!password) return

  const path = event.path || '/'
  if (EXEMPT.some(p => path === p || path.startsWith(p))) return

  if (getCookie(event, 'auth_token') === authToken()) return

  if (path.startsWith('/api/')) {
    setResponseStatus(event, 401)
    return { error: 'unauthorized' }
  }

  return sendRedirect(event, '/api/auth/login', 302)
})
