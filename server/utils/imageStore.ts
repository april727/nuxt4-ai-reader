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

/** 同一张图（sha256 相同）在同一文章内不重复落盘，返回已有地址 */
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

  if (useR2()) {
    try {
      await r2Put(key, data, contentType)
      return { key, url, storage: 'r2', bytes: data.length }
    } catch (e: any) {
      console.warn(`[image] R2 上传失败，回退本地: ${e.message}`)
    }
  }

  const dir = getImagesDir(folderId, textId)
  try {
    ensureDir(dir)
    writeFileSync(join(dir, filename), data)
  } catch (e: any) {
    throw createError({
      statusCode: 500,
      message: `图片存储失败：本地文件系统不可写，且 R2 不可用（${e.message}）`,
    })
  }

  return { key, url, storage: 'local', bytes: data.length }
}
