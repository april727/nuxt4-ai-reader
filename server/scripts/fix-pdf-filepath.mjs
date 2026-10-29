/**
 * 修复 PDF 文章的 filePath 指向已不存在的临时文件。
 *
 * 背景：早期导入把 `filePath` 记成 uploads/ 里的裸文件名（`1778xx_170-175.pdf`），
 * 源文件后来被归档到 `files/<folder>/<id>/source.pdf`，但 DB 没跟着改，
 * 而 `server/data/uploads/` 里的临时文件会被清理掉。结果就是「查看 PDF 原文」
 * 直接 404 —— 不是功能坏了，是这行数据指向了一个不存在的路径。
 *
 * 只处理能自证的情况：contentDir 里确实有 .pdf 源文件才改，找不到就原样保留。
 *
 * 用法：
 *   node server/scripts/fix-pdf-filepath.mjs           # 只看，不改
 *   node server/scripts/fix-pdf-filepath.mjs --write   # 落库
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { q, qRun } from './_testdb.mjs'

const WRITE = process.argv.includes('--write')
const FILES_ROOT = path.resolve('server/data/files')
const UPLOADS = path.resolve('server/data/uploads')

function contentDirs(contentId) {
  const out = []
  let folders = []
  try { folders = readdirSync(FILES_ROOT) } catch { return out }
  for (const f of folders) {
    const p = path.join(FILES_ROOT, f, contentId)
    try { if (statSync(p).isDirectory()) out.push(p) } catch {}
  }
  return out
}

/** 按 resolveFilePath 的顺序判断当前 filePath 还能不能读到 */
function resolvable(fp) {
  if (!fp) return false
  if (fp.includes('/')) return existsSync(path.join(FILES_ROOT, fp))
  return existsSync(path.join(UPLOADS, fp)) || existsSync(path.join(FILES_ROOT, fp))
}

const rows = await q(`SELECT id, title, folder, filePath FROM texts WHERE filePath LIKE '%.pdf' AND deletedAt IS NULL`)
let fixed = 0
let broken = 0

for (const r of rows) {
  if (resolvable(r.filePath)) {
    console.log(`✓ ${r.id}  ${r.filePath}`)
    continue
  }
  const dir = contentDirs(r.id).find((d) => existsSync(path.join(d, 'source.pdf')))
  if (!dir) {
    broken++
    console.log(`✗ ${r.id}  ${r.filePath}  ← 文件真丢了，contentDir 里也没有 source.pdf`)
    continue
  }
  const rel = `${path.basename(path.dirname(dir))}/${path.basename(dir)}/source.pdf`
  console.log(`→ ${r.id}  ${r.filePath}  ⇒  ${rel}`)
  if (WRITE) await qRun('UPDATE texts SET filePath=? WHERE id=?', [rel, r.id])
  fixed++
}

console.log(`\n可修复 ${fixed} 条，文件缺失 ${broken} 条，总计 ${rows.length} 条`)
if (fixed && !WRITE) console.log('（预览模式，加 --write 才会落库）')
