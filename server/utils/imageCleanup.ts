/**
 * 图片引用清理
 *
 * 标记里的配图以 Markdown 形式存在 detail 中，文件在 R2/本地。
 * 永久删除标记时，先看这张图是否还被别处引用（其他标记、段落图、封面），
 * 没有引用才真正删除，避免误删共用图。
 */
import { existsSync, unlinkSync } from 'node:fs'
import { queryOne } from './db'
import { useR2, r2Delete } from './r2'
import { resolveFilePath } from './storage'

/** 从 Markdown 中提取站内图片地址（只认 /api/file/ 开头） */
export function extractImageUrls(text: string): string[] {
  const urls = new Set<string>()
  const re = /!\[[^\]]*\]\((\/api\/file\/[^)\s]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text || '')) !== null) urls.add(m[1])
  return [...urls]
}

/** 该地址是否仍被任何文本引用（正文、段落、封面） */
async function isReferenced(url: string): Promise<boolean> {
  const row = await queryOne(
    'SELECT id FROM texts WHERE cover=? OR marks LIKE ? OR segments LIKE ? LIMIT 1',
    [url, `%${url}%`, `%${url}%`],
  )
  return Boolean(row)
}

/** 批量清理未被引用的图片，返回删除数量 */
export async function cleanupImages(urls: string[]): Promise<number> {
  let removed = 0
  for (const url of urls) {
    if (!url.startsWith('/api/file/')) continue
    try {
      if (await isReferenced(url)) continue
      const key = decodeURIComponent(url.slice('/api/file/'.length))

      if (useR2()) {
        try { await r2Delete(key) } catch {}
      }
      const local = resolveFilePath(key)
      if (existsSync(local)) {
        try { unlinkSync(local) } catch {}
      }
      removed++
    } catch {
      // 单张失败不影响其他
    }
  }
  return removed
}
