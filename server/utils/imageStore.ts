/**
 * 图片写入：R2 优先，本地文件系统回退。
 *
 * 统一入口的目的：此前标记图片只写本地（upload/image），段落插图才同步 R2，
 * 导致同一功能在部署环境下表现不一致。所有新图片都走这里。
 */
import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { queryOne } from './db'
import { getImagesDir, ensureDir } from './storage'
import { useR2, r2Put } from './r2'

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
}

/** 由 MIME 推断扩展名；未知类型回落 .png 之前先看文件名 */
export function extFromMime(contentType?: string | null, filename?: string): string {
  const mime = (contentType || '').split(';')[0].trim().toLowerCase()
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime]
  if (filename && filename.includes('.')) {
    const ext = '.' + filename.split('.').pop()!.toLowerCase()
    if (/^\.(png|jpe?g|webp|gif|avif|svg)$/.test(ext)) return ext
  }
  return '.png'
}

/** 解析文章真实所属文件夹，避免全部堆到 default/ */
export async function resolveFolderId(textId: string): Promise<string> {
  try {
    const row = await queryOne('SELECT folder FROM texts WHERE id=?', [textId])
    return (row?.folder as string) || 'default'
  } catch {
    return 'default'
  }
}

export interface StoredImage {
  /** 相对存储键，如 folder_xxx/txt_xxx/images/img_ab12cd34.webp */
  key: string
  /** 对外访问地址 */
  url: string
  storage: 'r2' | 'local'
  bytes: number
}

/** 等待 R2 上传完成的上限；超时则先返回本地地址，R2 继续后台补传 */
const R2_BLOCK_MS = 2000

/**
 * 同一张图（sha256 相同）在同一文章内不重复落盘，返回已有地址。
 *
 * 性能设计（实测依据）：
 * 本机到 R2 的上传带宽只有约 55~100 KB/s，1.4MB 图要 14s、900KB 要 16s，
 * 期间请求一直挂起 —— 这是"插入图片极慢"的直接原因。
 * 因此改为**本地先落盘**（毫秒级）并立即可用于读取，R2 上传最多阻塞 2s；
 * 超时就让它在后台继续，不拖住用户交互。
 * /api/file 读取时先查 R2 再回退本地，所以两种状态都能正常显示。
 */
export async function storeImage(
  data: Buffer,
  contentType: string,
  textId: string,
  opts: { hash?: string } = {},
): Promise<StoredImage> {
  const folderId = await resolveFolderId(textId)
  const ext = extFromMime(contentType)
  // 默认用内容指纹做文件名：同一张图重复粘贴会命中同一 key，天然去重
  const hash = opts.hash || createHash('sha256').update(data).digest('hex').slice(0, 16)
  const filename = `img_${hash}${ext}`
  const key = `${folderId}/${textId}/images/${filename}`
  const url = `/api/file/${encodeURIComponent(key)}`

  // 1) 先写本地：保证读路径立刻可用，同时作为 R2 失败时的兜底
  let localOk = false
  try {
    const dir = getImagesDir(folderId, textId)
    ensureDir(dir)
    writeFileSync(join(dir, filename), data)
    localOk = true
  } catch (e: any) {
    console.warn(`[image] 本地写入失败: ${e.message}`)
  }

  // 2) R2 上传：限时阻塞，超时转后台（不阻塞响应）
  if (useR2()) {
    const put = r2Put(key, data, contentType)
    let timer: ReturnType<typeof setTimeout> | null = null
    const timeout = new Promise<'timeout'>(resolve => {
      timer = setTimeout(() => resolve('timeout'), R2_BLOCK_MS)
    })
    try {
      const winner = await Promise.race([put.then(() => 'r2' as const), timeout])
      if (winner === 'r2') {
        if (timer) clearTimeout(timer)
        return { key, url, storage: 'r2', bytes: data.length }
      }
      // 超时：后台继续，失败只记日志
      put.catch((e: any) => console.warn(`[image] R2 后台补传失败: ${e?.message || e}`))
      console.warn(`[image] R2 上传超过 ${R2_BLOCK_MS}ms，先返回本地地址并后台补传: ${key}`)
      if (localOk) return { key, url, storage: 'local', bytes: data.length }
    } catch (e: any) {
      if (timer) clearTimeout(timer)
      console.warn(`[image] R2 上传失败，回退本地: ${e.message}`)
    }
  }

  if (localOk) return { key, url, storage: 'local', bytes: data.length }

  throw createError({
    statusCode: 500,
    message: '图片存储失败：本地文件系统不可写，且 R2 不可用',
  })
}
