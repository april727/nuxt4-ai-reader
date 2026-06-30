import { createHash } from 'node:crypto'

export default defineEventHandler(async (event) => {
  // 尝试从 form POST 或 JSON 读取密码
  let password = ''
  try {
    const body = await readBody(event)
    password = body?.password || ''
  } catch {
    // 如果 readBody 失败（Netlify Functions 可能的问题），
    // 尝试从 query string 读取
    password = getQuery(event).password as string || ''
  }

  const correct = process.env['SITE_PASSWORD']

  if (!correct || !password || password !== correct) {
    const errHtml = loginPage('密码错误')
    setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    setResponseStatus(event, 401)
    return errHtml
  }

  // 正确 → 设置 cookie，30 天有效
  const token = createHash('sha256').update(password).digest('hex')
  setCookie(event, 'auth_token', token, {
    maxAge: 30 * 24 * 60 * 60,
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
  })

  // 返回成功页，通过 meta refresh 跳转（比 sendRedirect 更可靠）
  const successHtml = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/">
<style>*{margin:0;padding:0}body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fafaf8;color:#1a1a18}</style></head>
<body><p>验证成功，跳转中...</p><script>location.replace('/')</script></body></html>`
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  return successHtml
})

function loginPage(error = '') {
  const errorBlock = error ? `<div class="error">${error}</div>` : ''
  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Reading</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,"PingFang SC",sans-serif;background:#fafaf8;display:flex;align-items:center;justify-content:center;min-height:100dvh}.card{background:#fff;border-radius:12px;padding:32px 28px;width:320px;max-width:90vw;text-align:center;box-shadow:0 2px 16px rgba(0,0,0,0.06)}h1{font-size:20px;color:#1a1a18;margin-bottom:6px}p{font-size:13px;color:#a09e97;margin-bottom:20px}input{width:100%;padding:10px 14px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;font-family:inherit;color:#1a1a18;outline:none;transition:border-color .15s}input:focus{border-color:#3d3591}button{width:100%;margin-top:12px;padding:10px;border:none;border-radius:8px;background:#3d3591;color:#fff;font-size:14px;font-family:inherit;cursor:pointer;transition:background .12s}button:hover{background:#2d2670}.error{color:#b84b2e;font-size:12px;margin-top:8px}</style></head>
<body><div class="card"><h1>AI Reading</h1><p>请输入访问密码</p><form method="post" action="/api/auth/login"><input type="password" name="password" placeholder="密码" autofocus><button type="submit">进入</button>${errorBlock}</form></div></body></html>`
}
