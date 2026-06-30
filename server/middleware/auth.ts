/**
 * 全站密码保护中间件 — 已禁用
 * 如需重新启用，在环境变量中设置 SITE_PASSWORD 即可
 */
export default defineEventHandler(() => {
  const password = process.env['SITE_PASSWORD']
  if (!password) return // 未设置密码，跳过保护
  // 密码已设置但中间件已禁用，不做任何拦截
  return
})
