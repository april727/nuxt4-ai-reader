/**
 * 文件读取的统一出口（/api/file 与 /api/file/[...name] 共用）。
 *
 * 读取顺序：**本地优先 → R2 兜底**。
 *
 * 为什么不是 R2 优先（原来的实现）：
 * `storeImage` 本来就是「先写本地、再传 R2」，所以本地一定有一份；
 * R2 优先意味着每次看图都要多一次 HeadObject 往返，命中了还要 302 让浏览器
 * 跨境去 R2 拉图（1~3s/张）。本地读是毫秒级，跨国 R2 是它的 100 倍。
 *
 * 安全性：图片 key 是 `folder/textId/images/img_<sha256前16位>.<ext>`，内容寻址，
 * 同一 key 本地与 R2 内容必然一致，本地优先不会出现"读到旧图"。
 * 源文件（source.pdf）不是内容寻址，本地覆盖即最新，也只会更准。
 *
 * 本地不存在时（云部署换机、历史文件只在 R2）自动回落 R2，行为与原来一致。
 */
import { createReadStream, existsSync, statSync, writeFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import { createError, getHeader, getQuery, setHeader, setResponseStatus, sendRedirect } from 'h3'
import type { H3Event } from 'h3'
import { resolveFilePath, filesRoot, ensureDir } from './storage'
import { useR2, r2Head, r2GetStream, r2GetBuffer, r2SignedUrl } from './r2'
import { canDerive, ensureDerived, normalizeDeriveWidth } from './imageDerive'

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mov': 'video/quicktime',
  '.vtt': 'text/vtt',
  '.srt': 'text/plain',
}

/** 需要 Range 的大媒体：本地走 206，R2 走流代理（不能 302，否则拖动进度条会重新连） */
const MEDIA_EXTS = new Set(['.mp4', '.webm', '.mov', '.ogg', '.mp3', '.wav', '.m4a'])
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg'])

function mimeOf(name: string) {
  return MIME[path.extname(name).toLowerCase()] || 'application/octet-stream'
}

/** 回填上限：超过这个体积的对象不回填本地，直接流代理（视频等大文件） */
const HYDRATE_MAX = 32 * 1024 * 1024

/**
 * 本地缺失时的回填：从 R2 取一次，写到本地 files/ 下，之后都走本地。
 *
 * 为什么必须回填而不是像原来那样 302 给浏览器：
 * 302 会把「一次图片请求」变成「浏览器 → 境外 R2 的跨境连接」，
 * 首屏 3~5 张图就是 3~5 个跨境 TLS 握手，慢且不稳定（R2 抖动时整页卡住）。
 * 回填后：第一次由服务端取（一次连接、可复用），第二次起纯本地磁盘。
 *
 * 写入用 .part 临时名 + rename，避免进程中断留下半截文件，
 * 半截文件会被 statSync().size > 0 判定为"本地命中"，那才是真正难查的问题。
 */
async function hydrateFromR2(name: string): Promise<string | null> {
  if (!name.includes('/')) return null // 旧格式（无目录）不做回填，交给原回退逻辑
  const buf = await r2GetBuffer(name, HYDRATE_MAX)
  if (!buf || !buf.length) return null
  const target = path.join(filesRoot(), name)
  ensureDir(path.dirname(target))
  const tmp = `${target}.part`
  writeFileSync(tmp, buf)
  renameSync(tmp, target)
  return target
}

export async function serveStoredFile(event: H3Event, name: string) {
  const ext = path.extname(name).toLowerCase()
  const mime = mimeOf(name)
  const isImage = IMAGE_EXTS.has(ext)
  // ── 1) 本地优先 ──
  let localPath = resolveFilePath(name)
  let size = 0
  try {
    size = existsSync(localPath) ? statSync(localPath).size : 0
  } catch {
    size = 0
  }

  // 本地没有 → 从 R2 回填一次，回填成功就完全走下面的本地分支
  let hydrated = false
  if (size === 0 && useR2()) {
    try {
      const backfilled = await hydrateFromR2(name)
      if (backfilled) {
        localPath = backfilled
        size = statSync(backfilled).size
        hydrated = true
      }
    } catch (e: any) {
      console.warn(`[file] 回填本地失败，改用 R2 直读: ${name} (${e?.message || e})`)
    }
  }

  if (size > 0) {
    // ── 派生缩略图：?w=800 → 现算/复用 WebP，体积从 MB 级掉到百 KB 级 ──
    //    失败（sharp 不可用、GIF/SVG、原图本来就不宽）一律忽略，保持原图语义。
    let source = hydrated ? 'r2-cache' : 'local'
    let contentType = mime
    if (isImage && canDerive(name)) {
      const width = normalizeDeriveWidth(getQuery(event).w)
      if (width) {
        const derived = await ensureDerived(localPath, width)
        if (derived) {
          // 实际宽度可能小于请求档位（原图不够宽时不放大），按文件名回报真实值
          const realW = path.basename(derived).match(/@(\d+)w\.webp$/)?.[1] || String(width)
          localPath = derived
          size = statSync(derived).size
          contentType = 'image/webp'
          source = `${source}+derive${realW}`
        }
      }
    }

    // 排查用：local = 本来就在本地；r2-cache = 这次刚从 R2 取回来并缓存到本地；
    //        末尾 +derive<宽度> 表示这次返回的是派生的 WebP
    setHeader(event, 'X-File-Source', source)
    setHeader(event, 'Accept-Ranges', 'bytes')
    setHeader(event, 'Content-Type', contentType)
    // 图片按内容寻址，永远不变 → 让浏览器强缓存，二次打开直接读磁盘缓存（0 请求）
    setHeader(
      event,
      'Cache-Control',
      isImage ? 'private, max-age=31536000, immutable' : 'private, max-age=3600',
    )

    const rangeHeader = getHeader(event, 'range')
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
      if (!match) {
        setResponseStatus(event, 416)
        setHeader(event, 'Content-Range', `bytes */${size}`)
        return
      }
      const start = parseInt(match[1], 10)
      const end = match[2] ? parseInt(match[2], 10) : size - 1
      if (start >= size || end >= size) {
        setResponseStatus(event, 416)
        setHeader(event, 'Content-Range', `bytes */${size}`)
        return
      }
      setResponseStatus(event, 206)
      setHeader(event, 'Content-Range', `bytes ${start}-${end}/${size}`)
      setHeader(event, 'Content-Length', end - start + 1)
      return createReadStream(localPath, { start, end })
    }

    setHeader(event, 'Content-Length', size)
    return createReadStream(localPath)
  }

  // ── 2) R2 兜底（回填失败才会走到：对象过大、或回填时网络抖动）
  //    原则：图片一律由服务端直读，不再 302 把浏览器甩到境外 R2 —— 那是首屏最慢的一环。
  if (useR2()) {
    try {
      const head = await r2Head(name)
      if (head) {
        if (MEDIA_EXTS.has(ext) || isImage) {
          setHeader(event, 'Content-Type', mime)
          setHeader(event, 'Content-Length', head.ContentLength!)
          setHeader(event, 'Accept-Ranges', 'bytes')
          setHeader(event, 'X-File-Source', 'r2-proxy')
          return r2GetStream(name)
        }
        const signedUrl = await r2SignedUrl(name, 3600)
        sendRedirect(event, signedUrl, 302)
        return
      }
    } catch (e: any) {
      console.warn(`[file] R2 不可达: ${name} (${e?.message || e})`)
    }
  }

  throw createError({ statusCode: 404, message: '文件不存在' })
}
