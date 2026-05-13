import { get } from 'node:https'
import { request as httpRequest } from 'node:http'
import { getDb, saveDb } from '../utils/db'

function fetchHtml(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const mod = parsed.protocol === 'https:' ? get : httpRequest
    const req = mod(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 20000,
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchHtml(new URL(res.headers.location, url).href))
      }
      let data = ''
      res.on('data', (chunk) => data += chunk)
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.on('error', reject)
  })
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ url: string }>(event)
  if (!body?.url) throw createError({ statusCode: 400, message: '缺少 URL' })

  let url = body.url.trim()
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url

  try {
    // 1. 抓取 HTML
    const html = await fetchHtml(url)

    // 2. Readability 提取
    const { JSDOM } = await import('jsdom')
    const { Readability } = await import('@mozilla/readability')

    const dom = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    if (!article || !article.textContent?.trim()) {
      throw createError({ statusCode: 422, message: '未能从该页面提取到正文内容' })
    }

    const title = article.title || url
    const text = article.textContent.trim()

    // 3. 保存到 SQLite（URL 去重）
    const db = await getDb()
    const stmt = db.prepare('SELECT id,title FROM texts WHERE source=?')
    stmt.bind([url])
    if (stmt.step()) { const r = stmt.getAsObject(); stmt.free(); return { id: r.id, title: r.title, existed: true } }
    stmt.free()

    const id = `txt_${Date.now()}`
    db.run('INSERT INTO texts (id,title,text,source,folder,excerpt,createdAt) VALUES (?,?,?,?,?,?,?)',
      [id, title.slice(0, 200), text.slice(0, 100000), url, 'default', text.replace(/\s+/g, ' ').trim().slice(0, 150), new Date().toISOString()])
    await saveDb()
    return { id, title }
  } catch (err: any) {
    console.error('URL 提取失败:', err.message || err)
    throw createError({ statusCode: 500, message: err.message || '提取失败' })
  }
})
