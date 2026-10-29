/**
 * 图片派生（按需缩略图）。
 *
 * 要解决的问题：AI 搜图进来的都是原图，1776×997 的 PNG 平均 2.9MB、最大 6MB。
 * 阅读页里一张图最多也就占 1330px 宽，等于把 3MB 的解码结果丢掉 90% 再显示 ——
 * 带宽、磁盘缓存、解码耗时全部白花。滚动一篇文章（10 张）要解 29MB 的位图。
 *
 * 方案：`/api/file/<key>?w=800` → sharp 生成 WebP 存回**原图同目录**，
 * 之后同一 URL 直接读文件。放同目录而不是集中的 .derive 树，是因为删除文章
 * 走的是「按内容目录整体删」，派生文件跟着走，天然不会留垃圾。
 *
 * 三条设计约束：
 * 1. **不放大，但照转码**：目标宽度取 min(请求档位, 原宽)。原图只有 924px 时请求 2000 档
 *    不 resize，也要把 PNG 转成 WebP —— 单这一项就能把 953KB 压到 90KB。
 *    只有「转码后反而更大」才退回原图（已经压过的小 WebP/JPEG 会遇到）。
 * 2. **档位收敛**：query 里的任意数字先吸附到固定档位（480/800/1200…），
 *    否则 `?w=1..2400` 每个值都会落一个缓存文件，几百张图能把盘塞满。
 *    派生文件按**实际宽度**命名，所以多个档位能复用同一个文件。
 * 3. **失败即降级**：sharp 不可用、格式不支持（GIF/SVG/动图）、文件损坏，
 *    一律返回 null 由调用方回退原图 —— 缩略图是优化，不能变成单点故障。
 */
import { existsSync, statSync, renameSync, unlinkSync } from 'node:fs'
import path from 'node:path'

/** 固定档位：向上吸附（宁可略大不要糊）。前端 srcset 只出这几档。 */
export const DERIVE_WIDTHS = [320, 480, 640, 800, 1200, 1600, 2000] as const
const MIN_W = 200
const MAX_W = 2400

/** 不派生的格式：GIF 动图（会丢帧）、SVG（矢量，缩放无意义） */
const SKIP_EXTS = new Set(['.gif', '.svg'])

export function canDerive(name: string): boolean {
  return !SKIP_EXTS.has(path.extname(name).toLowerCase())
}

/** query 里的宽度 → 档位；非法值返回 null（表示"不要派生"） */
export function normalizeDeriveWidth(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  if (!Number.isFinite(n) || n <= 0) return null
  const clamped = Math.min(MAX_W, Math.max(MIN_W, Math.round(n)))
  return DERIVE_WIDTHS.find((w) => w >= clamped) ?? MAX_W
}

/** 派生文件放原图同目录：`.../images/img_abc.png` → `.../images/img_abc@800w.webp` */
export function derivedPath(localPath: string, width: number): string {
  const dir = path.dirname(localPath)
  const base = path.basename(localPath, path.extname(localPath))
  return path.join(dir, `${base}@${width}w.webp`)
}

/**
 * 进程内串行化：同一张图同一档位被并发请求时，只真正编码一次，
 * 其余等待同一个 Promise。不做的话，一篇 10 图文章首屏会同时起 10~20 个 sharp 编码，
 * CPU 打满反而更慢（本机 6 核无独显）。
 */
const inflight = new Map<string, Promise<string | null>>()

let sharpWarned = false

/**
 * 返回可读的派生图路径；返回 null 表示「不要派生，用原图」。
 * 调用方必须能接受 null 并回退，不要把它当错误抛出去。
 */
export async function ensureDerived(localPath: string, width: number): Promise<string | null> {
  // 快路径：声明档位已有现成文件就直接给（绝大多数请求走这里）
  const fast = derivedPath(localPath, width)
  try {
    if (existsSync(fast) && statSync(fast).size > 0) return fast
  } catch { /* 交给下面重新生成 */ }

  const lockKey = `${localPath}#${width}`
  const running = inflight.get(lockKey)
  if (running) return running

  const job = (async (): Promise<string | null> => {
    let sharp: any
    try {
      sharp = (await import('sharp')).default
    } catch (e: any) {
      if (!sharpWarned) {
        sharpWarned = true
        console.warn('[imageDerive] sharp 不可用，全部图片回退原图：', e?.message || e)
      }
      return null
    }

    try {
      const img = sharp(localPath, { animated: false })
      const meta = await img.metadata()
      if (!meta?.width) return null

      /**
       * 目标宽度 = min(请求档位, 原宽)。
       * **不放大，但仍转码**：原图只有 924px 时，请求 2000 档不 resize，只是把
       * PNG 转成 WebP —— 单这一项就能把 953KB 压到 ~90KB，比原图直出省 90%。
       * 用「实际宽度」命名派生文件，多个档位因此落到同一个文件，不会重复占盘。
       */
      const targetW = Math.min(width, meta.width)
      const target = derivedPath(localPath, targetW)

      try {
        if (existsSync(target) && statSync(target).size > 0) return target
      } catch { /* 继续生成 */ }

      const tmp = `${target}.part`
      await img
        .rotate() // 按 EXIF 摆正（手机拍的图常见）
        .resize({ width: targetW, withoutEnlargement: true })
        .webp({ quality: 78, effort: 4 })
        .toFile(tmp)

      // 已经压过的图（如小尺寸 WebP/JPEG）转码后可能反而更大，此时留原图
      const derivedSize = statSync(tmp).size
      const originSize = statSync(localPath).size
      if (derivedSize >= originSize) {
        try { unlinkSync(tmp) } catch { /* ignore */ }
        return null
      }

      // 原子落盘：.part → 正式名。中断只会留下 .part，不会被当成"已生成"
      renameSync(tmp, target)
      return target
    } catch (e: any) {
      try { if (existsSync(fast + '.part')) unlinkSync(fast + '.part') } catch { /* ignore */ }
      console.warn(`[imageDerive] 生成失败 ${path.basename(localPath)}@${width}: ${e?.message || e}`)
      return null
    }
  })()

  inflight.set(lockKey, job)
  try {
    return await job
  } finally {
    inflight.delete(lockKey)
  }
}
