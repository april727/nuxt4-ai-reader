/**
 * 将浏览器导出的 JSON cookie 文件转为 yt-dlp 兼容的 Netscape 格式
 * 用法: node server/scripts/convert-cookies.mjs [输入文件名]
 *
 * 默认读取 server/data/youtube-cookies.txt (JSON)，原地覆写为 Netscape 格式
 * 也可指定其他文件名，如: node server/scripts/convert-cookies.mjs youtube_cookies.json
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(__dirname, '..', 'data')
const inputName = process.argv[2] || 'youtube-cookies.txt'
const filePath = resolve(dataDir, inputName)

const raw = readFileSync(filePath, 'utf-8')
const data = JSON.parse(raw)

const cookies = Array.isArray(data) ? data : (data.cookies || [])

const lines = ['# Netscape HTTP Cookie File', '']
for (const c of cookies) {
  const domain = c.domain || ''
  const flag = c.hostOnly ? 'FALSE' : 'TRUE'
  const path = c.path || '/'
  const secure = c.secure ? 'TRUE' : 'FALSE'
  const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0
  const name = c.name || ''
  const value = c.value || ''
  lines.push(`${domain}\t${flag}\t${path}\t${secure}\t${expiry}\t${name}\t${value}`)
}

// 原地覆写（输入是 JSON，输出是 Netscape）
writeFileSync(filePath, lines.join('\r\n'), 'utf-8')
console.log(`✅ 已转换 ${cookies.length} 条 cookie → ${filePath} (Netscape 格式)`)
