/**
 * R2（Cloudflare）连通性/凭据/桶检查脚本
 * 运行: npx tsx scripts/check-r2.ts
 *
 * 它会检查：
 *   1. 配置是否齐全
 *   2. 网络能否到达 R2（连接/超时）
 *   3. 凭据是否有效
 *   4. 目标 bucket 是否存在、能否读取
 */
import { S3Client, HeadBucketCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

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

async function main() {
  loadEnv()

  console.log('=== R2 配置检查 ===')
  console.log('  USE_R2      :', process.env.USE_R2)
  console.log('  endpoint    :', process.env.R2_ENDPOINT)
  console.log('  bucket      :', process.env.R2_BUCKET)
  console.log('  accessKey   :', (process.env.R2_ACCESS_KEY_ID || '').slice(0, 8) + '...')
  console.log('  secretKey   :', (process.env.R2_SECRET_ACCESS_KEY || '').slice(0, 8) + '...')
  console.log()

  if (!process.env.R2_ENDPOINT || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET) {
    console.log('❌ 配置不完整：需要 R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET')
    return
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
    maxAttempts: 1, // 不重试，快速失败
    requestHandler: new NodeHttpHandler({ connectionTimeout: 8000, socketTimeout: 8000 }),
  })

  // ── 1. 网络 + 凭据：HeadBucket ──
  try {
    await client.send(new HeadBucketCommand({ Bucket: process.env.R2_BUCKET! }))
    console.log(`✅ 网络可达，凭据有效，Bucket「${process.env.R2_BUCKET}」存在`)
  } catch (e: any) {
    console.log('❌ HeadBucket 失败:')
    console.log('   name:', e.name)
    console.log('   message:', e.message)
    console.log()
    if (e.name === 'TimeoutError' || String(e.message).includes('ETIMEDOUT') || String(e.name).includes('Timeout')) {
      console.log('   → 网络无法到达 R2（连接超时）。请检查：')
      console.log('       1) 服务器/本机是否能访问外网；')
      console.log('       2) 公司网络/防火墙/代理是否拦截了 r2.cloudflarestorage.com；')
      console.log('       3) DNS 能否解析 endpoint（可试: ping ' + (process.env.R2_ENDPOINT || '').replace(/^https?:\/\//, '') + '）。')
    } else if (e.name === '403' || String(e.$metadata?.httpStatusCode) === '403') {
      console.log('   → 凭据无效或无权访问该 bucket。请在 Cloudflare 控制台重新生成 R2 API Token（权限含 Object Read/Write + Bucket 访问）。')
    } else if (String(e.$metadata?.httpStatusCode) === '404' || e.name === '404') {
      console.log('   → Bucket 不存在 或 endpoint 的 Account ID 不对。')
    } else {
      console.log('   → 其它错误，可把完整报错发给我。')
    }
    return
  }

  // ── 2. 读取权限：ListObjects ──
  try {
    const res = await client.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET!, MaxKeys: 5 }))
    const keys = (res.Contents || []).map(o => o.Key).join(', ') || '(空)'
    console.log(`✅ 可读取 Bucket，前几个对象: ${keys}`)
  } catch (e: any) {
    console.log('⚠️  桶可访问但 ListObjects 失败（可能缺少 list 权限）:', e.name, e.message)
    console.log('   图片直连不受影响，仅影响列举。')
  }
}

main()
