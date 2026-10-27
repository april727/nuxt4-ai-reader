/**
 * Cloudflare R2 对象存储（S3 兼容）
 *
 * 通过环境变量切换后端：
 *   USE_R2=true  → R2 云端存储
 *   USE_R2=false → 本地 filesystem（storage.ts）
 */
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NodeHttpHandler } from '@smithy/node-http-handler'

let r2Client: S3Client | null = null

function getClient(): S3Client {
  if (r2Client) return r2Client

  r2Client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
    maxAttempts: 1, // 不重试，快速失败以便回退本地
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 5000,
      socketTimeout: 5000,
    }),
  })
  return r2Client
}

const bucket = () => process.env.R2_BUCKET || 'nuxt4-reader-files'

/** 判断是否使用 R2 */
export function useR2(): boolean {
  return process.env.USE_R2 === 'true'
}

/** 上传文件到 R2 */
export async function r2Put(key: string, body: Buffer | Uint8Array | ReadableStream, contentType?: string) {
  const client = getClient()
  return client.send(new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    Body: body,
    ContentType: contentType,
  }))
}

/** 从 R2 读取文件内容（返回流） */
export async function r2GetStream(key: string) {
  const client = getClient()
  const cmd = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
  })
  const response = await client.send(cmd)
  return response.Body
}

/**
 * 把整个对象读成 Buffer（用于「本地缺失时回填本地」）。
 *
 * 只给图片这类小对象用：超过 limit 直接放弃回填，避免把几百 MB 的视频读进内存。
 */
export async function r2GetBuffer(key: string, limit = 32 * 1024 * 1024): Promise<Buffer | null> {
  const client = getClient()
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: key }))
    const len = Number(res.ContentLength || 0)
    if (len > limit) return null
    const body: any = res.Body
    if (!body) return null
    if (typeof body.transformToByteArray === 'function') {
      const arr = await body.transformToByteArray()
      return Buffer.from(arr)
    }
    // 兜底：按流收集
    const chunks: Buffer[] = []
    for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
    const buf = Buffer.concat(chunks)
    return buf.length > limit ? null : buf
  } catch (e: any) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null
    throw e
  }
}

/** 获取文件元数据（大小、类型等） */export async function r2Head(key: string) {
  const client = getClient()
  try {
    return await client.send(new HeadObjectCommand({
      Bucket: bucket(),
      Key: key,
    }))
  } catch (e: any) {
    if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return null
    throw e
  }
}

/** 删除文件 */
export async function r2Delete(key: string) {
  const client = getClient()
  return client.send(new DeleteObjectCommand({
    Bucket: bucket(),
    Key: key,
  }))
}

/** 生成签名 URL（临时直链，用于视频播放/下载） */
export async function r2SignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  const client = getClient()
  return getSignedUrl(client, new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
  }), { expiresIn: expiresInSeconds })
}
