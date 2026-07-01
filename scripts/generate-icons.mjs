// 从 app/public/icon.png 生成各尺寸图标
// 用法: npm install sharp && node scripts/generate-icons.mjs
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = join(__dirname, '..', 'app', 'public')
const src = join(publicDir, 'icon.png')

try {
  const sharp = await import('sharp')
  const img = sharp.default(src)

  // favicon-32x32
  await img.clone().resize(32, 32).png().toFile(join(publicDir, 'favicon-32x32.png'))

  // apple-touch-icon 180x180
  await img.clone().resize(180, 180).png().toFile(join(publicDir, 'apple-touch-icon.png'))

  // PWA icons
  await img.clone().resize(192, 192).png().toFile(join(publicDir, 'icon-192.png'))
  await img.clone().resize(512, 512).png().toFile(join(publicDir, 'icon-512.png'))

  // favicon.ico (multi-size: 16, 32)
  const buf16 = await img.clone().resize(16, 16).png().toBuffer()
  const buf32 = await img.clone().resize(32, 32).png().toBuffer()

  // simple ICO format (32x32 only, browsers accept this)
  const icoBuf = Buffer.alloc(6 + 16 + buf32.length)
  icoBuf.writeUInt16LE(0, 0)  // reserved
  icoBuf.writeUInt16LE(1, 2)  // ICO type
  icoBuf.writeUInt16LE(1, 4)  // 1 image
  icoBuf.writeUInt8(32, 6)    // width
  icoBuf.writeUInt8(32, 7)    // height
  icoBuf.writeUInt8(0, 8)     // color palette
  icoBuf.writeUInt8(0, 9)     // reserved
  icoBuf.writeUInt16LE(1, 10) // color planes
  icoBuf.writeUInt16LE(32, 12) // bits per pixel
  icoBuf.writeUInt32LE(buf32.length, 14) // image size
  icoBuf.writeUInt32LE(22, 18) // offset
  buf32.copy(icoBuf, 22)

  const fs = await import('node:fs')
  fs.writeFileSync(join(publicDir, 'favicon.ico'), icoBuf)

  console.log('✅ 图标生成完成:')
  console.log('  favicon.ico')
  console.log('  favicon-32x32.png')
  console.log('  apple-touch-icon.png (180x180)')
  console.log('  icon-192.png')
  console.log('  icon-512.png')
} catch (e) {
  if (e.code === 'ERR_MODULE_NOT_FOUND' || e.message?.includes('Cannot find')) {
    console.error('请先安装 sharp: npm install sharp')
    process.exit(1)
  }
  console.error('错误:', e.message)
  process.exit(1)
}
