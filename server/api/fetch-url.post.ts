import { get } from 'node:https'
import { request as httpRequest } from 'node:http'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import iconv from 'iconv-lite'
import { queryOne, runQuery } from '../utils/db'

/**
 * 网页正文抓取
 *
 * 设计要点（对应此前的四个缺陷）：
 *  1. 段落结构：不再存 article.textContent（jsdom 的 textContent 拼接各块不带分隔符，
 *     整篇会变成一大段）。改为遍历正文 HTML 的「叶子块」（p/h1-h6/li/blockquote…），
 *     以空行连接，图片单独成段 —— 与阅读页的分段/朗读管线一致。
 *  2. 字符集：先读 Content-Type 的 charset，再看 <meta charset>，最后兜底 utf-8；
 *     用 iconv-lite 解码，解决 GBK/GB2312 老站整篇乱码。
 *  3. SSRF：仅允许 http(s)，拒绝 localhost/.local/.internal 与私有网段，
 *     DNS 解析后逐个地址校验；重定向的每一跳都重新校验。
 *  4. 资源上限：响应体 5MB、重定向 5 次、单次超时 20s，避免超大页面或跳转环。
 */

const MAX_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 5
const TIMEOUT_MS = 20000
const MAX_TEXT = 100_000
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

/* ---------------- SSRF 防护 ---------------- */

function ipIsPrivate(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const p = ip.split('.').map(Number)
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true
    if (p[0] === 169 && p[1] === 254) return true // 链路本地（含云元数据地址）
    if (p[0] === 192 && p[1] === 168) return true
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true // CGNAT
    return false
  }
  if (v === 6) {
    const s = ip.toLowerCase()
    if (s === '::1' || s === '::') return true
    if (s.startsWith('fc') || s.startsWith('fd')) return true // 唯一本地
    if (/^fe[89ab]/.test(s)) return true // 链路本地
    if (s.startsWith('::ffff:')) return ipIsPrivate(s.slice(7))
    return false
  }
  return false
}

async function assertSafeUrl(u: URL): Promise<void> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw createError({ statusCode: 400, message: '仅支持 http/https 链接' })
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host) throw createError({ statusCode: 400, message: '链接缺少主机名' })
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw createError({ statusCode: 403, message: '不允许访问内网地址' })
  }
  let ips: string[] = []
  if (isIP(host)) {
    ips = [host]
  } else {
    try {
      ips = (await lookup(host, { all: true })).map(r => r.address)
    } catch {
      throw createError({ statusCode: 400, message: '域名解析失败' })
    }
  }
  if (!ips.length) throw createError({ statusCode: 400, message: '域名解析失败' })
  if (ips.some(ipIsPrivate)) {
    throw createError({ statusCode: 403, message: '不允许访问内网地址' })
  }
}

/* ---------------- 抓取 ---------------- */

interface FetchResult { buf: Buffer; contentType: string; finalUrl: string }

function requestOnce(url: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; buf: Buffer }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const mod = parsed.protocol === 'https:' ? get : httpRequest
    const req = mod(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeout: TIMEOUT_MS,
    }, (res) => {
      const chunks: Buffer[] = []
      let total = 0
      res.on('data', (chunk: Buffer) => {
        total += chunk.length
        if (total > MAX_BYTES) {
          res.destroy()
          reject(new Error('页面内容过大（超过 5MB）'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, buf: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    req.on('timeout', () => { req.destroy(new Error('抓取超时')) })
    req.on('error', reject)
  })
}

async function fetchHtml(startUrl: string): Promise<FetchResult> {
  let current = startUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSafeUrl(new URL(current))
    const { status, headers, buf } = await requestOnce(current)

    if (status >= 300 && status < 400 && headers.location) {
      if (hop === MAX_REDIRECTS) throw new Error('重定向次数过多')
      current = new URL(String(headers.location), current).href
      continue
    }
    if (status >= 400) throw new Error(`目标站点返回 ${status}`)

    const ct = String(headers['content-type'] || '')
    if (ct && !/html|xml|text\/plain/i.test(ct)) {
      throw new Error(`不支持的内容类型：${ct.split(';')[0]}`)
    }
    return { buf, contentType: ct, finalUrl: current }
  }
  throw new Error('重定向次数过多')
}

/* ---------------- 解码 ---------------- */

function normalizeCharset(cs: string): string {
  const c = cs.toLowerCase()
  if (c === 'gb2312' || c === 'gb_2312-80' || c === 'gbk' || c === 'x-gbk') return 'gbk'
  if (c === 'utf8') return 'utf-8'
  if (c === 'big5' || c === 'big-5' || c === 'cp950') return 'big5'
  return c
}

function detectCharset(buf: Buffer, contentType: string): string {
  const m = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)
  if (m) return normalizeCharset(m[1])
  // 从头部 4KB 的 ASCII 区域嗅探 <meta charset>
  const head = buf.subarray(0, 4096).toString('latin1')
  const m2 = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)
  if (m2) return normalizeCharset(m2[1])
  return 'utf-8'
}

function decodeHtml(buf: Buffer, contentType: string): string {
  const charset = detectCharset(buf, contentType)
  try {
    if (charset !== 'utf-8' && iconv.encodingExists(charset)) return iconv.decode(buf, charset)
  } catch {}
  return buf.toString('utf-8')
}

/* ---------------- 正文转段落 ---------------- */

const BLOCK_TAGS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figcaption, td, dd'

/** 把相对/懒加载地址补成绝对地址；非 http(s) 一律丢弃 */
function toAbsolute(src: string, base: string): string {
  if (!src) return ''
  const s = src.trim()
  if (/^data:/i.test(s)) return ''
  try {
    const abs = new URL(s, base).href
    return /^https?:/i.test(abs) ? abs : ''
  } catch {
    return ''
  }
}

/**
 * 从正文 HTML 抽取「叶子块」，每块一段。
 * 取叶子块（内部不含其他块级元素）是为了避免 <li><p>x</p></li> 这类嵌套重复输出。
 */
function extractParagraphs(contentHtml: string, baseUrl: string, doc: Document): string[] {
  const holder = doc.createElement('div')
  holder.innerHTML = contentHtml || ''

  const out: string[] = []
  const seenImg = new Set<string>()

  const pushImages = (el: Element) => {
    for (const img of Array.from(el.querySelectorAll('img'))) {
      const raw = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original') || ''
      const abs = toAbsolute(raw, baseUrl)
      if (abs && !seenImg.has(abs)) {
        seenImg.add(abs)
        out.push(`![](${abs})`)
      }
    }
  }

  for (const el of Array.from(holder.querySelectorAll(BLOCK_TAGS))) {
    // 内部还有块级元素 → 交给子块处理，避免整段重复
    if (el.querySelector(BLOCK_TAGS)) continue
    pushImages(el)
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
    if (text.length >= 2) out.push(text)
  }

  // 顶层散图（不在任何块内）
  pushImages(holder)

  // 兜底：没有可用块结构时按纯文本输出
  if (out.length === 0) {
    const plain = (holder.textContent || '').replace(/\s+/g, ' ').trim()
    if (plain) out.push(plain)
  }
  return out
}

/** 摘要用：去掉 Markdown 图片、压平空白 */
function toExcerpt(text: string): string {
  return text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150)
}

/* ---------------- 接口 ---------------- */

export default defineEventHandler(async (event) => {
  const body = await readBody<{ url: string }>(event)
  if (!body?.url) throw createError({ statusCode: 400, message: '缺少 URL' })

  let url = String(body.url).trim()
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url

  try {
    // 1. 抓取（SSRF 校验 + 重定向上限 + 5MB 上限）
    const { buf, contentType, finalUrl } = await fetchHtml(url)

    // 2. 解码（GBK/GB2312/Big5 等）
    const html = decodeHtml(buf, contentType)

    // 3. Readability 提取正文
    const { JSDOM } = await import('jsdom')
    const { Readability } = await import('@mozilla/readability')
    const dom = new JSDOM(html, { url: finalUrl })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    if (!article || !article.content) {
      throw createError({ statusCode: 422, message: '未能从该页面提取到正文内容' })
    }

    // 4. 按段落组织（保留插图），而不是整篇 textContent
    const paragraphs = extractParagraphs(String(article.content), finalUrl, dom.window.document)
    const text = paragraphs.join('\n\n').slice(0, MAX_TEXT)

    if (!text.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim()) {
      throw createError({ statusCode: 422, message: '该页面没有可读的正文内容' })
    }

    const title = (article.title || dom.window.document.title || finalUrl).trim().slice(0, 200)
    const excerpt = toExcerpt(text)

    // 5. 按 URL 去重
    const row = await queryOne('SELECT id,title FROM texts WHERE source=?', [url])
    if (row) return { id: row.id, title: row.title, existed: true }

    const id = `txt_${Date.now()}`
    await runQuery(
      'INSERT INTO texts (id,title,text,source,folder,excerpt,createdAt) VALUES (?,?,?,?,?,?,?)',
      [id, title, text, url, 'default', excerpt, new Date().toISOString()],
    )

    return { id, title, paragraphs: paragraphs.length, chars: text.length }
  } catch (err: any) {
    console.error('URL 提取失败:', err?.message || err)
    if (err?.statusCode) throw err
    throw createError({ statusCode: 502, message: err?.message || '无法抓取该网页' })
  }
})
