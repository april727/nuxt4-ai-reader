/**
 * 文件存储迁移脚本
 *
 * 将 server/data/uploads/ 中的扁平文件重组为分层结构：
 *   files/{folderId}/{contentId}/source.ext     — 源文件
 *   files/{folderId}/{contentId}/thumbs/cover.ext — 缩略图
 *   files/{folderId}/{contentId}/images/img_xxx.png — 段落插图
 *
 * 运行方式：npx tsx server/scripts/migrate-files.ts
 */

import initSqlJs from 'sql.js'
import {
  readFileSync, writeFileSync, existsSync,
  mkdirSync, renameSync, copyFileSync, readdirSync, rmSync, statSync,
} from 'node:fs'
import { join, extname, basename } from 'node:path'

const DATA_DIR = join(process.cwd(), 'server', 'data')
const DB_PATH = join(DATA_DIR, 'reader.db')
const UPLOADS_DIR = join(DATA_DIR, 'uploads')
const FILES_DIR = join(DATA_DIR, 'files')

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function safeMove(src: string, dest: string): boolean {
  if (!existsSync(src)) return false
  ensureDir(join(dest, '..'))
  try {
    renameSync(src, dest)
    return true
  } catch {
    try {
      copyFileSync(src, dest)
      return true
    } catch {
      return false
    }
  }
}

interface TextRow {
  id: string
  folder: string
  filePath: string
  videoMeta: string
  segments: string
}

async function main() {
  console.log('📦 开始文件存储迁移...\n')

  if (!existsSync(DB_PATH)) {
    console.error('❌ 未找到 reader.db，请确认路径:', DB_PATH)
    process.exit(1)
  }

  const SQL = await initSqlJs()
  const buf = readFileSync(DB_PATH)
  const db = new SQL.Database(buf)

  // 获取所有内容记录
  const stmt = db.prepare('SELECT id, folder, filePath, videoMeta, segments FROM texts')
  const rows: TextRow[] = []
  while (stmt.step()) {
    const r = stmt.getAsObject() as unknown as TextRow
    rows.push(r)
  }
  stmt.free()

  let movedSource = 0
  let movedThumb = 0
  let movedImages = 0
  let skipped = 0
  const errors: string[] = []

  for (const row of rows) {
    const folderId = row.folder || 'default'
    const contentDir = join(FILES_DIR, folderId, row.id)

    try {
      // ── 1. 源文件迁移 ──
      if (row.filePath && !row.filePath.includes('/')) {
        const src = join(UPLOADS_DIR, row.filePath)
        if (existsSync(src)) {
          const ext = extname(row.filePath)
          const dest = join(contentDir, `source${ext}`)
          ensureDir(contentDir)
          if (safeMove(src, dest)) {
            const newPath = `${folderId}/${row.id}/source${ext}`
            db.run('UPDATE texts SET filePath=? WHERE id=?', [newPath, row.id])
            movedSource++
          } else {
            errors.push(`源文件移动失败: ${row.filePath}`)
          }
        } else {
          skipped++
        }
      }

      // ── 2. 缩略图迁移 ──
      if (row.videoMeta) {
        try {
          const meta = JSON.parse(row.videoMeta)
          if (meta.thumbnail && !meta.thumbnail.includes('/')) {
            const thumbName = meta.thumbnail
            const src = join(UPLOADS_DIR, thumbName)
            if (existsSync(src)) {
              const ext = extname(thumbName) || '.jpg'
              const thumbsDir = join(contentDir, 'thumbs')
              const dest = join(thumbsDir, `cover${ext}`)
              ensureDir(thumbsDir)
              if (safeMove(src, dest)) {
                meta.thumbnail = `${folderId}/${row.id}/thumbs/cover${ext}`
                db.run('UPDATE texts SET videoMeta=? WHERE id=?', [JSON.stringify(meta), row.id])
                movedThumb++
              } else {
                errors.push(`缩略图移动失败: ${thumbName}`)
              }
            }
          }
        } catch {}
      }

      // ── 3. 段落插图迁移 ──
      if (row.segments) {
        try {
          const segments = JSON.parse(row.segments)
          let changed = false
          for (const seg of segments) {
            if (seg.images && Array.isArray(seg.images)) {
              const newImages: string[] = []
              for (const imgName of seg.images) {
                if (typeof imgName === 'string' && !imgName.includes('/')) {
                  const src = join(UPLOADS_DIR, imgName)
                  if (existsSync(src)) {
                    const imagesDir = join(contentDir, 'images')
                    const dest = join(imagesDir, imgName)
                    ensureDir(imagesDir)
                    if (safeMove(src, dest)) {
                      newImages.push(`${folderId}/${row.id}/images/${imgName}`)
                      movedImages++
                      changed = true
                    } else {
                      newImages.push(imgName) // 保留原名
                    }
                  } else {
                    // 文件不存在，保留原名
                    newImages.push(imgName)
                  }
                } else {
                  newImages.push(imgName)
                }
              }
              seg.images = newImages
            }
          }
          if (changed) {
            db.run('UPDATE texts SET segments=? WHERE id=?', [JSON.stringify(segments), row.id])
          }
        } catch {}
      }
    } catch (err: any) {
      errors.push(`${row.id}: ${err.message}`)
    }
  }

  // ── 清理 ──
  // 删除孤儿 videos/ 子目录
  const orphanVideosDir = join(UPLOADS_DIR, 'videos')
  if (existsSync(orphanVideosDir)) {
    try { rmSync(orphanVideosDir, { recursive: true, force: true }) } catch {}
  }

  // 删除旧的 JSON 文件（已迁移到 SQLite）
  for (const name of ['texts.json', 'folders.json']) {
    const p = join(DATA_DIR, name)
    if (existsSync(p)) {
      try {
        const backupDir = join(DATA_DIR, 'backups')
        ensureDir(backupDir)
        renameSync(p, join(backupDir, `${name}.migrated`))
      } catch {}
    }
  }

  // 保存 DB
  const data = db.export()
  writeFileSync(DB_PATH, Buffer.from(data))
  db.close()

  // ── 报告 ──
  console.log('✅ 迁移完成!\n')
  console.log(`   源文件移动: ${movedSource}`)
  console.log(`   缩略图移动: ${movedThumb}`)
  console.log(`   段落插图移动: ${movedImages}`)
  console.log(`   跳过（无文件）: ${skipped}`)
  if (errors.length > 0) {
    console.log(`\n⚠️  错误 (${errors.length}):`)
    errors.forEach(e => console.log(`   - ${e}`))
  }

  // 显示 uploads 剩余文件
  if (existsSync(UPLOADS_DIR)) {
    const remaining = readdirSync(UPLOADS_DIR).filter(f => !f.startsWith('.'))
    if (remaining.length > 0) {
      console.log(`\n📁 uploads/ 剩余 ${remaining.length} 个文件（可能是已迁移但未删除的副本）:`)
      remaining.forEach(f => console.log(`   - ${f}`))
    } else {
      console.log('\n📁 uploads/ 已清空')
    }
  }

  console.log('\n新目录结构预览:')
  if (existsSync(FILES_DIR)) {
    const topDirs = readdirSync(FILES_DIR).filter(f => !f.startsWith('.'))
    for (const d of topDirs.slice(0, 5)) {
      const p = join(FILES_DIR, d)
      if (statSync(p).isDirectory()) {
        const subs = readdirSync(p)
        console.log(`   ${d}/`)
        for (const s of subs.slice(0, 3)) {
          const sp = join(p, s)
          if (statSync(sp).isDirectory()) {
            const items = readdirSync(sp)
            items.slice(0, 4).forEach(item => {
              const isDir = statSync(join(sp, item)).isDirectory()
              console.log(`     ${s}/${item}${isDir ? '/' : ''}`)
            })
          }
        }
      }
    }
    if (topDirs.length > 5) console.log(`   ... 还有 ${topDirs.length - 5} 个文件夹`)
  }
}

main().catch(err => {
  console.error('❌ 迁移失败:', err)
  process.exit(1)
})
