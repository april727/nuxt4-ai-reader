import { syncFromTurso } from '../../utils/sync-from-turso'
import { getSqljsHandle, isNativeLocal } from '../../utils/db'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve('server/data/reader.db')

/**
 * 手动从云端拉取（换机、或在别处改过数据时用）。
 *
 * 本地是 node:sqlite 时，直接把结果写进主库句柄即可，
 * **不能**再用「整库 dump 覆盖文件」那套 —— WAL 模式下覆盖
 * 正在使用的数据库文件会破坏主库。
 */
export default defineEventHandler(async () => {
  try {
    const db = await getSqljsHandle()
    const native = await isNativeLocal()

    // sql.js 兜底模式：先把内存里的待保存改动刷到磁盘
    if (!native && existsSync(DB_PATH)) {
      writeFileSync(DB_PATH, Buffer.from(db.export()))
    }

    const result = await syncFromTurso(db)

    if (!native && (result.totalInserted > 0 || result.totalUpdated > 0)) {
      writeFileSync(DB_PATH, Buffer.from(db.export()))
    }
    return { ...result, native }
  } catch (e: any) {
    throw createError({ statusCode: 500, message: '拉取失败: ' + (e.message || '未知错误') })
  }
})
