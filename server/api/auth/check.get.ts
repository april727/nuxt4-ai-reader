/**
 * 诊断端点 — 检查环境变量和 crypto 是否正常
 * GET /api/auth/check
 */
export default defineEventHandler(async () => {
  const results: Record<string, any> = {}

  // 1. 环境变量
  results.env = {
    SITE_PASSWORD: process.env['SITE_PASSWORD'] ? '✅ 已设置' : '❌ 未设置',
    USE_TURSO: process.env['USE_TURSO'] || '未设置',
    TURSO_URL: process.env['TURSO_URL'] ? '已设置' : '未设置',
    TURSO_AUTH_TOKEN: process.env['TURSO_AUTH_TOKEN'] ? '已设置' : '未设置',
  }

  // 2. crypto.subtle
  try {
    const encoder = new TextEncoder()
    const data = encoder.encode('test')
    const buf = await crypto.subtle.digest('SHA-256', data)
    results.crypto = '✅ SHA-256 可用: ' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16) + '...'
  } catch (e: any) {
    results.crypto = '❌ 不可用: ' + e.message
  }

  // 3. Node.js version
  results.node = process.version

  return results
})
