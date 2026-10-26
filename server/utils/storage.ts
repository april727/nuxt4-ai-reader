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

/** 文件根目录（files/）—— 读取层需要它把 R2 对象回填到本地 */
export function filesRoot(): string {
  return FILES_ROOT
}

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
 * 按 contentId 跨文件夹定位内容目录。
 *
 * 为什么必须跨 folder 找：文章被拖到别的文件夹时只改了 `texts.folder`，
 * 文件物理目录（以及 R2 key）仍留在旧 folder 前缀下——key 里带 folderId，
 * 一改名所有 url 引用（segments / marks / cover）就全失效，不能跟着搬。
 * 于是"按当前 folder 拼路径"必然 miss，永久删除时旧目录就永久残留。
 */
export function findContentDirs(contentId: string): string[] {
  const out: string[] = []
  if (!contentId || /[\\/]|\.\./.test(contentId)) return out
  let folders: string[] = []
  try {
    folders = readdirSync(FILES_ROOT)
  } catch {
    return out
  }
  for (const f of folders) {
    const p = join(FILES_ROOT, f, contentId)
    try {
      if (statSync(p).isDirectory()) out.push(p)
    } catch {}
  }
  return out
}

/**
 * 将整个内容目录移动到垃圾箱
 * 如果不存在，返回 null（无文件可移动）
 *
 * 会搬迁该 contentId 在**所有** folder 下的目录（见 findContentDirs），
 * 不只是当前 folder，避免移动过的文章留下孤儿目录。
 */
export function moveToTrash(
  folderId: string,
  contentId: string,
  title: string,
): string | null {
  const dirs = findContentDirs(contentId)
  if (!dirs.length) {
    const fallback = getContentDir(folderId, contentId)
    if (!existsSync(fallback)) return null
    dirs.push(fallback)
  }

  const { dir: trashDir, name } = getTrashPath(new Date(), contentId, title)
  ensureDir(dirname(trashDir))

  let i = 0
  for (const src of dirs) {
    // 主目录沿用原命名 contentId，其余（旧 folder 残留）加 folder 后缀区分
    const dest = i === 0 ? join(trashDir, contentId) : join(trashDir, `${contentId}__${basename(dirname(src))}`)
    i++
    try {
      renameSync(src, dest)
    } catch {
      // 跨分区回退：递归复制
      copyRecursive(src, dest)
      rmRecursive(src)
    }
  }

  return name
}

// ---- 内部工具 ----

/**
 * 删掉某个内容在垃圾箱里的归档目录（永久删除时调用）。
 *
 * 之前永久删除只删数据库行、不删垃圾箱里的归档目录，
 * 「永久删除」实际上是把文件从 files/ 搬到 trash/ 就再也没人管了 —— 磁盘只增不减。
 */
export function dropTrashOf(contentId: string): number {
  let names: string[] = []
  try { names = readdirSync(TRASH_ROOT) } catch { return 0 }
  let n = 0
  for (const name of names) {
    if (!name.includes(contentId)) continue
    try {
      rmSync(join(TRASH_ROOT, name), { recursive: true, force: true })
      n++
    } catch {}
  }
  return n
}

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
