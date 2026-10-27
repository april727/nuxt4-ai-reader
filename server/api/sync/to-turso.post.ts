import { runMirrorNow } from '../../utils/db'

/**
 * 手动把本地主库镜像到云端。
 *
 * 不能直接调 syncToTurso() 让它自己读 reader.db：
 * 主库是 WAL 模式，最新写入还在 -wal 里，读文件会漏掉最后一批改动。
 * runMirrorNow 走的是主库句柄，拿到的永远是最新状态。
 */
export default defineEventHandler(async () => {
  const r = await runMirrorNow()
  if (!r.ok) {
    throw createError({ statusCode: 500, message: '同步失败: ' + (r.error || '未知错误') })
  }
  return {
    ok: true,
    totalInserted: r.inserted,
    totalUpdated: r.updated,
  }
})
