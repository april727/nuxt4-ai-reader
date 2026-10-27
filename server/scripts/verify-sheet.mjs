/**
 * 图片试卷链路验证
 *
 * 覆盖：创建（多图）→ 尺寸解析 → contentKind/segments 落库 → 标注写入
 * → 非法数据过滤 → 坐标越界裁剪 → 清理。
 *
 * 用法：node server/scripts/verify-sheet.mjs
 * 依赖：本地 dev 服务（默认 http://localhost:3000）与 .env 的 SITE_PASSWORD
 */
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

const env = readFileSync('.env', 'utf8').split(/\r?\n/).reduce((a, l) => {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) a[m[1]] = m[2].replace(/^["']|["']$/g, '')
  return a
}, {})

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const TOKEN = createHash('sha256').update(env.SITE_PASSWORD || '').digest('hex')
const H = { Cookie: `auth_token=${TOKEN}` }

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok })
  console.log(`${ok ? '  ok ' : '  FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

/** 找一张仓库里已有的 png 当测试图，避免引入二进制夹具 */
function findSampleImage() {
  const root = 'server/data/files'
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (/\.png$/i.test(e.name)) return p
    }
  }
  return null
}

async function api(pathname, init = {}) {
  const res = await fetch(`${BASE}${pathname}`, { ...init, headers: { ...H, ...(init.headers || {}) } })
  const text = await res.text()
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${text.slice(0, 200)}`)
  try { return JSON.parse(text) } catch { return text }
}

const img = findSampleImage()
if (!img) {
  console.error('没有找到可用于测试的 png')
  process.exit(1)
}
const bytes = readFileSync(img)
console.log(`测试图：${img} (${bytes.length}B)`)

// ── 1. 创建 ──
const fd = new FormData()
fd.append('title', '__sheet验证 单元测')
fd.append('file', new Blob([bytes], { type: 'image/png' }), 'p1.png')
fd.append('file', new Blob([bytes], { type: 'image/png' }), 'p2.png')
const created = await api('/api/sheet/create', { method: 'POST', body: fd })
check('创建返回 id', !!created.id, created.id)
check('返回 2 页', created.pages?.length === 2)
check('尺寸解析成功', created.pages?.every(p => p.w > 0 && p.h > 0), created.pages?.map(p => `${p.w}x${p.h}`).join(' '))

// ── 2. 落库形态 ──
const row = await api(`/api/text/${created.id}`)
check('contentKind=sheet', row.contentKind === 'sheet', String(row.contentKind))
check('segments 存的是页数组', Array.isArray(row.segments) && row.segments.length === 2)
check('annotations 初始为空', Array.isArray(row.annotations) && row.annotations.length === 0)

// ── 3. 标注读写 ──
const pageId = created.pages[0].id
const saved = await api(`/api/sheet/${created.id}/annotations`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    annotations: [
      { id: 'an_a', pageId, kind: 'wrong', bbox: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 }, note: '第 3 题符号错' },
      { id: 'an_b', pageId, kind: 'key', bbox: { x: 0.95, y: 0.95, w: 0.5, h: 0.4 } },
      { id: 'an_c', pageId, kind: 'nope', bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
      { id: 'an_d', pageId, kind: 'key', bbox: { x: 0.1, y: 0.1, w: 0, h: 0 } },
      { id: '', pageId, kind: 'key', bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    ],
  }),
})
check('零尺寸与空 id 被丢弃', saved.count === 3, `count=${saved.count}`)

const after = await api(`/api/text/${created.id}`)
const b = after.annotations.find(a => a.id === 'an_b')
check('越界坐标被裁到 [0,1]', !!b && Math.abs(b.bbox.x - 0.5) < 1e-6 && Math.abs(b.bbox.y - 0.6) < 1e-6,
  b ? `x=${b.bbox.x} y=${b.bbox.y}` : 'missing')
const c = after.annotations.find(a => a.id === 'an_c')
check('非法 kind 回落为 key', c?.kind === 'key', String(c?.kind))
check('备注与类型保留', after.annotations.find(a => a.id === 'an_a')?.note === '第 3 题符号错')

// ── 4. 清理 ──
await api('/api/text/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: created.id }) })
await api('/api/recycle/permanent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: created.id, kind: 'text' }) })
const gone = await api(`/api/text/${created.id}`).catch(() => null)
check('测试数据已清理', gone === null || gone === '' || !gone.id)

const failed = results.filter(r => !r.ok)
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
if (failed.length) process.exitCode = 1
