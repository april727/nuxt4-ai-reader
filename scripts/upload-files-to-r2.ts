/**
 * 文件迁移脚本：本地上传 → Cloudflare R2
 * 运行: npx tsx scripts/upload-files-to-r2.ts
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { resolve } from 'node:path'

// 手动加载 .env
function loadEnv() {
  const envPath = resolve('.env')
  if (!existsSync(envPath)) return
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.mov': 'video/quicktime', '.srt': 'text/plain', '.vtt': 'text/vtt',
}

function mimeType(filename: string): string {
  return MIME[extname(filename).toLowerCase()] || 'application/octet-stream'
}

function walkDir(dir: string, base: string): string[] {
  const result: string[] = []
  if (!existsSync(dir)) return result
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      result.push(...walkDir(full, base))
    } else {
      result.push(full)
    }
  }
  return result
}

async function main() {
  loadEnv()

  const client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
  })

  const bucket = process.env.R2_BUCKET || 'nuxt4-reader-files'
  const dataDir = resolve('server/data')
  const filesDir = join(dataDir, 'files')
  const uploadsDir = join(dataDir, 'uploads')

  // 1. files/ 目录（结构化：folderId/contentId/source.ext 等）
  console.log('📁 扫描 server/data/files/ ...')
  const filePaths = walkDir(filesDir, filesDir)

  // 2. uploads/ 目录（扁平文件：thumb_xxx.jpg, vid_xxx.mp4 等）
  console.log('📁 扫描 server/data/uploads/ ...')
  const uploadPaths = existsSync(uploadsDir)
    ? readdirSync(uploadsDir).filter(f => !f.startsWith('.') && statSync(join(uploadsDir, f)).isFile()).map(f => join(uploadsDir, f))
    : []

  const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.ogg', '.mp3', '.wav', '.m4a'])

  const allFiles = [
    ...filePaths
      .filter(p => !VIDEO_EXT.has(extname(p).toLowerCase()))
      .map(p => ({ abs: p, key: relative(filesDir, p).replace(/\\/g, '/') })),
    ...uploadPaths
      .filter(p => !VIDEO_EXT.has(extname(p).toLowerCase()))
      .map(p => ({ abs: p, key: relative(dataDir, p).replace(/\\/g, '/') })),
  ]

  console.log(`共 ${allFiles.length} 个文件\n`)

  if (allFiles.length === 0) {
    console.log('没有文件需要上传')
    return
  }

  let uploaded = 0
  let skipped = 0
  let errors = 0

  for (let i = 0; i < allFiles.length; i++) {
    const { abs, key } = allFiles[i]
    const size = statSync(abs).size
    const sizeStr = size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)}MB` : `${(size / 1024).toFixed(0)}KB`

    process.stdout.write(`\r[${i + 1}/${allFiles.length}] ${key} (${sizeStr})...`)

    try {
      const body = readFileSync(abs)
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: mimeType(key),
      }))
      uploaded++
    } catch (e: any) {
      if (e.name === 'NoSuchBucket') {
        console.error(`\n❌ 存储桶 "${bucket}" 不存在，请检查 R2 配置`)
        process.exit(1)
      }
      console.error(`\n⚠️  ${key}: ${e.message}`)
      errors++
    }

    // 大文件后换行显示进度
    if (size > 5 * 1024 * 1024) console.log()
  }

  console.log(`\n✅ 上传完成: ${uploaded} 成功, ${errors} 失败`)
  console.log(`\nR2 里现在有 ${uploaded} 个文件，设置 USE_R2=true 后即可从云端读取`)
}

main().catch(err => {
  console.error('❌', err.message)
  process.exit(1)
})
