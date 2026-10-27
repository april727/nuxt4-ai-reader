/**
 * 图片写入：**本地先落盘（唯一读取来源）+ R2 后台备份**。
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

/**
 * R2 备份上传最多阻塞多久（毫秒）。
 *
 * 默认 0 = **完全后台**：本地已落盘，读路径立刻可用，没必要让"保存"去等一次跨境上传。
 * 本机上行只有约 55KB/s，一张 900KB 的图要 16s —— 阻塞着等就是"保存很卡"的全部原因。
 *
 * 只有在"本地盘不可信"（多实例 / 容器随时回收）时才需要同步语义，
 * 那时设 IMAGE_R2_BLOCK_MS=2000，让它最多等 2s。
 */
const R2_BLOCK_MS = Number(process.env.IMAGE_R2_BLOCK_MS ?? 0)

/**
 * 连续失败达上限就暂停备份一段时间。
 *
 * 上行带宽被浏览器和上传共用，2 张图连续超时说明链路撑不住，
 * 继续重试只会把整条上行占满，反而拖慢正在显示的图片。
 * 图片本地都在，暂停期间不丢数据，冷却结束再补。
 */
const R2_FAIL_LIMIT = 2
const R2_COOLDOWN_MS = 5 * 60 * 1000
let r2FailStreak = 0
let r2CooldownUntil = 0
let cooldownLogged = false

function r2BackupPaused(): boolean {
  if (!useR2()) return true
  return Date.now() < r2CooldownUntil
}

function noteR2Fail(e: any) {
  r2FailStreak++
  if (r2FailStreak >= R2_FAIL_LIMIT) {
    r2CooldownUntil = Date.now() + R2_COOLDOWN_MS
    if (!cooldownLogged) {
      cooldownLogged = true
      console.warn(
        `[image] R2 连续 ${r2FailStreak} 次备份失败，${R2_COOLDOWN_MS / 60000} 分钟内只写本地（文件都在本地，不影响使用）: ${e?.message || e}`,
      )
    }
  } else {
    console.warn(`[image] R2 备份失败（第 ${r2FailStreak} 次，图片已存本地）: ${e?.message || e}`)
  }
}

function noteR2Ok() {
  r2FailStreak = 0
  cooldownLogged = false
}

/**
 * 仍在后台补传的 key → promise。
 *
 * 存在的唯一理由：超时转后台后，上传可能比"删除"更晚完成。
 * 若此时用户删掉文章，r2Delete 先跑、后台 put 后到，对象会被重新写回 R2，
 * 形成删不掉的残留。删除方需要先 await 对应 key 落地，再执行删除。
 */
const pendingPuts = new Map<string, Promise<unknown>>()

/** 取某个 key 尚在进行的后台补传（没有则 undefined） */
export function pendingR2Put(key: string): Promise<unknown> | undefined {
  return pendingPuts.get(key)
}

/**
 * 同一张图（sha256 相同）在同一文章内不重复落盘，返回已有地址。
 *
 * 性能设计（实测依据）：
 * 本机到 R2 的上传带宽只有约 55~100 KB/s，1.4MB 图要 14s、900KB 要 16s，
 * 期间请求一直挂起 —— 这是"插入图片极慢"的直接原因。
 * 因此改为**本地先落盘**（毫秒级）并立即可用于读取，R2 上传转后台（默认 0ms 阻塞）；
 * 且在连续失败后熔断冷却，避免把上行带宽全耗在必然超时的请求上。
 * /api/file 读取时本地优先，本地缺失才从 R2 回填一次并缓存到本地。
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

  // 2) R2 备份：默认不阻塞，本地副本已可用于读取
  if (!r2BackupPaused()) {
    const settled = r2Put(key, data, contentType).then(
      () => {
        noteR2Ok()
        return 'ok' as const
      },
      (e: any) => {
        noteR2Fail(e)
        return 'fail' as const
      },
    )

    // 本地没写成功 → 本地没有副本，必须等 R2 给出结论，不能提前返回一个取不到的地址
    if (!localOk) {
      const r = await settled
      if (r === 'ok') return { key, url, storage: 'r2', bytes: data.length }
      throw createError({ statusCode: 500, message: '图片存储失败：本地不可写，R2 上传也失败' })
    }

    // 记账：删除方要先等这次备份落地，否则 r2Delete 先跑、put 后到会把对象写回 R2
    let tracked: Promise<unknown>
    tracked = settled.finally(() => {
      if (pendingPuts.get(key) === tracked) pendingPuts.delete(key)
    })
    pendingPuts.set(key, tracked)

    if (R2_BLOCK_MS > 0) {
      let timer: ReturnType<typeof setTimeout> | null = null
      const timeout = new Promise<'timeout'>(resolve => {
        timer = setTimeout(() => resolve('timeout'), R2_BLOCK_MS)
      })
      const winner = await Promise.race([settled, timeout])
      if (timer) clearTimeout(timer)
      if (winner === 'ok') return { key, url, storage: 'r2', bytes: data.length }
    }

    return { key, url, storage: 'local', bytes: data.length }
  }

  if (localOk) return { key, url, storage: 'local', bytes: data.length }

  throw createError({
    statusCode: 500,
    message: '图片存储失败：本地文件系统不可写，且 R2 不可用',
  })
}
