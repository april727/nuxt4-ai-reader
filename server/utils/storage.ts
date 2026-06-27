/**
 * 统一文件存储路径管理
 *
 * 目录结构：
 *   server/data/files/{folderId}/{contentId}/source.ext     — 源文件
 *   server/data/files/{folderId}/{contentId}/thumbs/cover.ext — 缩略图
 *   server/data/files/{folderId}/{contentId}/images/img_xxx.png — 段落插图
 *   server/data/trash/{日期}_{contentId}_{标题}/              — 删除回收
 */

import { mkdirSync, existsSync, renameSync, copyFileSync, unlinkSync, readdirSync, statSync, rmSync } from 'node:fs'
import { join, extname, basename, dirname } from 'node:path'

const DATA_ROOT = join(process.cwd(), 'server', 'data')
const FILES_ROOT = join(DATA_ROOT, 'files')
const TRASH_ROOT = join(DATA_ROOT, 'trash')
const LEGACY_UPLOADS = join(DATA_ROOT, 'uploads')

/** 确保目录存在 */
export function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/** 获取内容根目录 */
export function getContentDir(folderId: string, contentId: string): string {
  return join(FILES_ROOT, folderId, contentId)
}

/** 图片子目录 */
export function getImagesDir(folderId: string, contentId: string): string {
  return join(FILES_ROOT, folderId, contentId, 'images')
}

/** 缩略图子目录 */
export function getThumbsDir(folderId: string, contentId: string): string {
  return join(FILES_ROOT, folderId, contentId, 'thumbs')
}

/** 源文件路径 — 统一命名为 source.ext */
export function getSourcePath(
  folderId: string,
  contentId: string,
  originalName: string,
): { dir: string; filename: string; relative: string } {
  const ext = extname(originalName) || ''
  const dir = getContentDir(folderId, contentId)
  const filename = `source${ext}`
  return { dir, filename, relative: `${folderId}/${contentId}/${filename}` }
}

/** 缩略图路径 */
export function getThumbPath(
  folderId: string,
  contentId: string,
  ext = '.jpg',
): { dir: string; filename: string; relative: string } {
  const dir = getThumbsDir(folderId, contentId)
  const filename = `cover${ext}`
  return { dir, filename, relative: `${folderId}/${contentId}/thumbs/${filename}` }
}

/** 段落插图路径 */
export function getImagePath(
  folderId: string,
  contentId: string,
  hash: string,
  ext = '.png',
): { dir: string; filename: string; relative: string } {
  const dir = getImagesDir(folderId, contentId)
  const filename = `img_${hash}${ext}`
  return { dir, filename, relative: `${folderId}/${contentId}/images/${filename}` }
}

/** 垃圾箱路径 */
export function getTrashPath(
  deletedAt: Date,
  contentId: string,
  title: string,
): { dir: string; name: string } {
  const dateStr = deletedAt.toISOString().slice(0, 10)
  const safe = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, '-').slice(0, 50)
  const name = `${dateStr}_${contentId}_${safe}`
  return { dir: join(TRASH_ROOT, name), name }
}

/**
 * 解析文件物理路径（兼容新旧两种结构）
 *   - 新格式 "folderId/contentId/source.ext" → files/...
 *   - 旧格式 "vid_xxx.mp4" / "thumb_xxx.jpg" → uploads/ → files/ 回退搜索
 */
export function resolveFilePath(name: string): string {
  // 新格式：包含 "/"
  if (name.includes('/')) {
    const p = join(FILES_ROOT, name)
    if (existsSync(p)) return p
  }

  // 旧格式兼容：先查 uploads/
  const legacy = join(LEGACY_UPLOADS, name)
  if (existsSync(legacy)) return legacy

  // 尝试新格式 files 根
  const newP = join(FILES_ROOT, name)
  if (existsSync(newP)) return newP

  // 旧格式回退：在 files/ 中递归搜索同名文件
  // 这是为迁移后 DB 未更新的情况兜底
  if (!name.includes('/')) {
    try {
      const found = findFileInFiles(FILES_ROOT, name, 0, 4)
      if (found) return found
    } catch {}
  }

  // 最终回退
  return join(FILES_ROOT, name)
}

/** 在 files/ 目录中递归搜索文件 */
function findFileInFiles(dir: string, filename: string, depth: number, maxDepth: number): string | null {
  if (depth > maxDepth || !existsSync(dir)) return null
  let entries: string[] = []
  try { entries = readdirSync(dir) } catch { return null }
  for (const entry of entries) {
    const full = join(dir, entry)
    try {
      if (statSync(full).isDirectory()) {
        const found = findFileInFiles(full, filename, depth + 1, maxDepth)
        if (found) return found
      } else if (entry === filename) {
        return full
      }
    } catch {}
  }
  return null
}

/**
 * 将临时文件移动到最终位置，返回新的相对路径。
 * 自动创建目标目录，支持跨分区 rename 回退到 copy+delete。
 */
export function moveToFinal(
  tempPath: string,        // 临时文件绝对路径
  folderId: string,
  contentId: string,
  originalName: string,
): string {
  const { dir, filename, relative } = getSourcePath(folderId, contentId, originalName)
  ensureDir(dir)
  const dest = join(dir, filename)

  try {
    renameSync(tempPath, dest)
  } catch {
    // 跨分区回退
    copyFileSync(tempPath, dest)
    try { unlinkSync(tempPath) } catch {}
  }

  return relative
}

/**
 * 将缩略图从临时路径移动到最终目录
 */
export function moveThumbToFinal(
  tempPath: string,
  folderId: string,
  contentId: string,
): string {
  const ext = extname(tempPath) || '.jpg'
  const { dir, filename, relative } = getThumbPath(folderId, contentId, ext)
  ensureDir(dir)
  const dest = join(dir, filename)

  try {
    renameSync(tempPath, dest)
  } catch {
    copyFileSync(tempPath, dest)
    try { unlinkSync(tempPath) } catch {}
  }

  return relative
}

/**
 * 将整个内容目录移动到垃圾箱
 * 如果不存在，返回 null（无文件可移动）
 */
export function moveToTrash(
  folderId: string,
  contentId: string,
  title: string,
): string | null {
  const srcDir = getContentDir(folderId, contentId)
  if (!existsSync(srcDir)) return null

  const { dir: trashDir, name } = getTrashPath(new Date(), contentId, title)
  ensureDir(dirname(trashDir))
  const dest = join(trashDir, contentId)

  try {
    renameSync(srcDir, dest)
  } catch {
    // 跨分区回退：递归复制
    copyRecursive(srcDir, dest)
    rmRecursive(srcDir)
  }

  return name
}

// ---- 内部工具 ----

function copyRecursive(src: string, dest: string) {
  ensureDir(dest)
  for (const entry of readdirSync(src)) {
    const s = join(src, entry)
    const d = join(dest, entry)
    if (statSync(s).isDirectory()) {
      copyRecursive(s, d)
    } else {
      copyFileSync(s, d)
    }
  }
}

function rmRecursive(dir: string) {
  try { rmSync(dir, { recursive: true, force: true }) } catch {}
}

export { DATA_ROOT, FILES_ROOT, TRASH_ROOT, LEGACY_UPLOADS }
