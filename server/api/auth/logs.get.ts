import { queryAll } from '../../utils/db'

/** GET /api/auth/logs → 最近登录记录（需已登录） */
export default defineEventHandler(async () => {
  const rows = await queryAll('SELECT time, ip, ua FROM auth_logs ORDER BY time DESC LIMIT 50')
  return rows
})
