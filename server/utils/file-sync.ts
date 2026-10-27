/**
 * 本地文件 → R2 自动同步工具
 * 每次本地文件写入后触发，延迟 30s 合并上传
 */
import { r2Put } from './r2'
import { readFileSync } from 'node:fs'

const pendingFiles = new Map<string, { path: string; contentType: string }>()
let fileSyncTimer: ReturnType<typeof setTimeout> | null = null

/** 标记一个文件需要同步到 R2 */
export function queueFileSync(key: string, localPath: string, contentType?: string) {
  if (process.env['USE_R2'] !== 'true') return  // 只在本地模式下触发
  pendingFiles.set(key, { path: localPath, contentType: contentType || 'application/octet-stream' })
  debounceSync()
}

function debounceSync() {
  if (fileSyncTimer) clearTimeout(fileSyncTimer)
  fileSyncTimer = setTimeout(async () => {
    const files = new Map(pendingFiles)
    pendingFiles.clear()
    let done = 0
    for (const [key, { path, contentType }] of files) {
      try {
        const buf = readFileSync(path)
        await r2Put(key, buf, contentType)
        done++
      } catch { /* 单个文件失败不阻塞其他 */ }
    }
    if (done > 0) console.log(`[file-sync] ${done}/${files.size} 个文件已同步到 R2`)
  }, 30_000)
}
