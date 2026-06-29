/**
 * 全站密码保护中间件
 * 环境变量 SITE_PASSWORD 设置访问密码，未设置则不启用
 */
import { createHash } from 'node:crypto'

const loginHtml = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Reading</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:"DM Sans","PingFang SC",sans-serif;background:#fafaf8;display:flex;align-items:center;justify-content:center;min-height:100dvh}.card{background:#fff;border-radius:12px;padding:32px 28px;width:320px;max-width:90vw;text-align:center;box-shadow:0 2px 16px rgba(0,0,0,0.06)}h1{font-size:20px;color:#1a1a18;margin-bottom:6px}p{font-size:13px;color:#a09e97;margin-bottom:20px}input{width:100%;padding:10px 14px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;font-family:inherit;color:#1a1a18;outline:none;transition:border-color .15s}input:focus{border-color:#3d3591}button{width:100%;margin-top:12px;padding:10px;border:none;border-radius:8px;background:#3d3591;color:#fff;font-size:14px;font-family:inherit;cursor:pointer;transition:background .12s}button:hover{background:#2d2670}.error{color:#b84b2e;font-size:12px;margin-top:8px}</style></head>
<body><div class="card"><h1>AI Reading</h1><p>请输入访问密码</p><form method="post" action="/api/auth/login"><input type="password" name="password" placeholder="密码" autofocus><button type="submit">进入</button>%ERROR%</form></div></body></html>`

export default defineEventHandler(async (event) => {
  const password = process.env['SITE_PASSWORD']
  if (!password) return  // 未设置密码，跳过保护

  const url = getRequestURL(event)

  // 允许登录 API 和静态资源
  if (url.pathname === '/api/auth/login' || url.pathname.startsWith('/_nuxt/')) return

  // 检查 cookie 中的 token
  const token = getCookie(event, 'auth_token')
  if (token === hashPassword(password)) return  // 已登录

  // 未登录 → 显示登录页
  setResponseStatus(event, 200)
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  return loginHtml.replace('%ERROR%', '')
})

function hashPassword(pw: string): string {
  return createHash('sha256').update(pw).digest('hex')
}
