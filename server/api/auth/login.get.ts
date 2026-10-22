/** GET /api/auth/login → 登录页 */
export default defineEventHandler((event) => {
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  return loginPage()
})
