/**
 * Cloudflare R2 对象存储（S3 兼容）
 *
 * 通过环境变量切换后端：
 *   USE_R2=true  → R2 云端存储
 *   USE_R2=false → 本地 filesystem（storage.ts）
 */
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

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

/** 获取文件元数据（大小、类型等） */
export async function r2Head(key: string) {
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
