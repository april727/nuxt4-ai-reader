import { syncFromTurso } from '../../utils/sync-from-turso'
import { getSqljsHandle } from '../../utils/db'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve('server/data/reader.db')

export default defineEventHandler(async () => {
  try {
    const db = await getSqljsHandle()
    // 先把主应用的待保存改动刷到磁盘
    if (existsSync(DB_PATH)) {
      const data = db.export()
      writeFileSync(DB_PATH, Buffer.from(data))
    }
    // 直连主数据库拉取，避免实例隔离
    const result = await syncFromTurso(db)
    // 写盘持久化
    if (result.totalInserted > 0 || result.totalUpdated > 0) {
      const data = db.export()
      writeFileSync(DB_PATH, Buffer.from(data))
    }
    return result
  } catch (e: any) {
    throw createError({ statusCode: 500, message: '拉取失败: ' + (e.message || '未知错误') })
  }
})
