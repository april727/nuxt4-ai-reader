/**
 * 全站密码保护中间件
 * 环境变量 SITE_PASSWORD 设置访问密码，未设置则不启用
 *
 * Netlify 部署注意：
 * 1. SITE_PASSWORD 必须设为 Functions 范围的 Secret
 * 2. 同时设置 USE_TURSO=true、TURSO_URL、TURSO_AUTH_TOKEN
 *    否则默认走 sql.js 模式，在 Netlify 无持久文件系统会报错
 */

const loginHtml = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Reading</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,"PingFang SC",sans-serif;background:#fafaf8;display:flex;align-items:center;justify-content:center;min-height:100dvh}.card{background:#fff;border-radius:12px;padding:32px 28px;width:320px;max-width:90vw;text-align:center;box-shadow:0 2px 16px rgba(0,0,0,0.06)}h1{font-size:20px;color:#1a1a18;margin-bottom:6px}p{font-size:13px;color:#a09e97;margin-bottom:20px}input{width:100%;padding:10px 14px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;font-family:inherit;color:#1a1a18;outline:none;transition:border-color .15s}input:focus{border-color:#3d3591}button{width:100%;margin-top:12px;padding:10px;border:none;border-radius:8px;background:#3d3591;color:#fff;font-size:14px;font-family:inherit;cursor:pointer;transition:background .12s}button:hover{background:#2d2670}.error{color:#b84b2e;font-size:12px;margin-top:8px;min-height:20px}</style></head>
<body><div class="card"><h1>AI Reading</h1><p>请输入访问密码</p><form method="post" action="/api/auth/login"><input type="password" name="password" placeholder="密码" autofocus required><button type="submit">进入</button><div class="error">%ERROR%</div></form></div></body></html>`

export default defineEventHandler(async (event) => {
  // 安全读取环境变量（用 try 包裹，兜底 Netlify 自定义环境变量读取异常）
  let password = ''
  try {
    password = process.env['SITE_PASSWORD'] || ''
  } catch {
    return // 读取失败，不做保护
  }

  if (!password) return // 未设置密码，跳过保护

  // 路径匹配：统一转小写比较，兼容各种代理格式
  let path = ''
  try {
    path = (event as any).path || event.node?.req?.url || getRequestURL(event).pathname || ''
  } catch {
    path = ''
  }

  const lower = path.toLowerCase()

  // 允许通过：登录接口、静态资源、API（API 被拦截会让前端数据加载失败）
  if (
    lower.includes('/api/auth') ||
    lower.startsWith('/_nuxt') ||
    lower.startsWith('/__nuxt') ||
    lower.includes('/fonts/')
  ) {
    return
  }

  // 检查 cookie
  let token = ''
  try {
    token = getCookie(event, 'auth_token') || ''
  } catch {
    token = ''
  }

  // 验证 token（用 Web Crypto API，Node.js 18+ 内置，无需 import）
  try {
    const encoder = new TextEncoder()
    const data = encoder.encode(password)
    const buffer = await crypto.subtle.digest('SHA-256', data)
    const expected = Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    if (token === expected) return // 已登录，放行
  } catch {
    // crypto.subtle 不可用 → 不安全，直接放行（避免整个站点不可访问）
    return
  }

  // 未登录 → 显示登录页
  try {
    setResponseStatus(event, 200)
    setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  } catch {}
  return loginHtml.replace('%ERROR%', '')
})
