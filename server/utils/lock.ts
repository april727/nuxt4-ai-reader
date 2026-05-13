// 简单内存锁 + 写入前自动备份
import { copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const locks = new Map<string, Promise<void>>()

export async function withLock(key: string, fn: () => Promise<void>): Promise<void> {
  const prev = locks.get(key) || Promise.resolve()
  const next = prev.then(fn).catch(() => {})
  locks.set(key, next)
  return next
}

export async function backupBeforeWrite(filePath: string) {
  if (!existsSync(filePath)) return
  const backupDir = path.dirname(filePath)
  const backupName = path.basename(filePath).replace('.json', `.backup-${Date.now()}.json`)
  const backupPath = path.join(backupDir, backupName)
  try { await copyFile(filePath, backupPath) } catch {}
}
