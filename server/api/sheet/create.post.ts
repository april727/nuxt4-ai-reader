import { runQuery } from '../../utils/db'
import { storeImage } from '../../utils/imageStore'
import { imageSize } from '../../utils/imageSize'
import { clearCache } from '../../utils/cache'
import { invalidateFolderCache } from '../../utils/folderCache'

/**
 * 创建「图片试卷」：一次请求完成「建行 + 存图 + 写 pages」。
 *
 * 为什么要合成一个请求：storeImage 需要按 textId 解析目录，必须先有行；
 * 若拆成两个接口，中途失败会留下没有任何页面的空壳记录。
 */
export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  if (!form?.length) throw createError({ statusCode: 400, message: '未收到文件' })

  const files = form.filter(f => f.name === 'file' && f.filename && f.data.length)
  if (!files.length) throw createError({ statusCode: 400, message: '请至少选择一张图片' })
  // 单次上限 30 页：一份试卷够用，也防止误传整个相册
  if (files.length > 30) throw createError({ statusCode: 400, message: '单次最多 30 张' })

  const titleRaw = form.find(f => f.name === 'title')?.data.toString('utf8') || ''
  const folder = form.find(f => f.name === 'folder')?.data.toString('utf8') || 'default'

  const id = `sht_${Date.now()}`
  const now = new Date().toISOString()
  const title = titleRaw.trim().slice(0, 80) || `图片试卷 ${now.slice(0, 10)}`

  await runQuery(
    `INSERT INTO texts (id,title,text,source,folder,excerpt,segments,contentKind,annotations,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, title, '', 'sheet', folder, '', '[]', 'sheet', '[]', now, now],
  )

  const pages: any[] = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const ct = (f.type || '').startsWith('image/') ? f.type! : 'image/png'
    const buf = Buffer.from(f.data)
    const stored = await storeImage(buf, ct, id)
    const dim = imageSize(buf)
    pages.push({
      id: `pg_${i + 1}`,
      url: stored.url,
      key: stored.key,
      w: dim.w,
      h: dim.h,
      bytes: stored.bytes,
    })
  }

  await runQuery('UPDATE texts SET segments=?, updatedAt=? WHERE id=?', [JSON.stringify(pages), new Date().toISOString(), id])

  clearCache()
  invalidateFolderCache()
  console.log(`[sheet/create] ${id} ${pages.length} 页 ${pages.reduce((s, p) => s + (p.bytes || 0), 0)}B`)
  return { id, title, pages }
})
