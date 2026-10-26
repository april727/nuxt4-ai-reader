/**
 * 永久删除时的文件清理验证（可重复运行）
 *
 * 覆盖两个真实缺陷：
 *  A. 文章被拖到别的文件夹后，物理目录仍留在旧 folder 下 ——
 *     删除时若只按「当前 folder」拼路径会 miss，旧目录永久残留。
 *  B. 图片试卷的页图 key 存在 segments 里（每页自带 key，不是段落 images 数组）——
 *     不收集就会只清本地、云端对象一直留着。
 *
 * 用法：node server/scripts/verify-trash-move.mjs
 * 依赖：本地 dev 服务 + .env 的 SITE_PASSWORD（与 verify-sheet.mjs 一致）
 */
import { readFileSync, readdirSync, statSync, rmSync } from 'node:fs'
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
const FILES = 'server/data/files'
const TRASH = 'server/data/trash'

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok })
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

const dirExists = (p) => {
  try { return statSync(p).isDirectory() } catch { return false }
}

async function api(pathname, init = {}) {
  const res = await fetch(`${BASE}${pathname}`, { ...init, headers: { ...H, ...(init.headers || {}) } })
  const text = await res.text()
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${text.slice(0, 200)}`)
  try { return JSON.parse(text) } catch { return text }
}

const postJSON = (p, body) => api(p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

/** 仓库里已有的 png 当测试图，不引入二进制夹具 */
function findSampleImage() {
  const stack = [FILES]
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

const imgPath = findSampleImage()
if (!imgPath) {
  console.error('没有找到可用于测试的 png')
  process.exit(1)
}
const imgBytes = readFileSync(imgPath)
console.log(`测试图：${imgPath} (${imgBytes.length}B)`)

/** 建一份单页试卷 */
async function createSheet(title) {
  const fd = new FormData()
  fd.append('title', title)
  fd.append('file', new Blob([imgBytes], { type: 'image/png' }), 'p1.png')
  const r = await api('/api/sheet/create', { method: 'POST', body: fd })
  return r
}

/** 文件是否还能取到（本地或 R2 任一路径命中都算"还在"） */
async function fileStillReachable(key) {
  const res = await fetch(`${BASE}/api/file/${encodeURIComponent(key)}`, { headers: H, redirect: 'manual' })
  // 200 = 本地命中（目录没搬走）；302 = R2 命中（key 没被收集删除）；404 = 两边都没了
  return { status: res.status, alive: res.status === 200 || res.status === 302 }
}

/**
 * 删除后文件应两边都取不到。
 * R2 的删除有最终一致性延迟（刚 DELETE 完立刻 HeadObject 可能仍命中），
 * 所以重试几次；仍 alive 时把状态码带出来，区分是本地没搬（200）还是 R2 没删（302）。
 */
async function fileEventuallyGone(key, tries = 6, delay = 400) {
  let last = await fileStillReachable(key)
  for (let i = 1; i < tries && last.alive; i++) {
    await new Promise(r => setTimeout(r, delay))
    last = await fileStillReachable(key)
  }
  return last
}

/** 清掉本次测试产生的垃圾箱目录与可能的孤儿文件目录 */
let cleanupFailed = 0
function dropDirsUnder(root, id) {
  let names = []
  try { names = readdirSync(root) } catch { return }
  for (const n of names) {
    if (!n.includes(id)) continue
    try {
      rmSync(path.join(root, n), { recursive: true, force: true })
    } catch (e) {
      // 安全删除保护会拦 rm：这里不再静默吞掉，否则每跑一次 trash 就多一份残留
      cleanupFailed++
      console.log(`  警告：未清理 ${path.join(root, n)}（${String(e?.message || e).slice(0, 60)}）`)
    }
  }
}
function dropTrashOf(id) {
  dropDirsUnder(TRASH, id)
  // 孤儿文件目录：旧实现删除时漏搬，只在反向验证时出现
  let folders = []
  try { folders = readdirSync(FILES) } catch { return }
  for (const f of folders) {
    const p = path.join(FILES, f, id)
    if (!dirExists(p)) continue
    try { rmSync(p, { recursive: true, force: true }) } catch { cleanupFailed++ }
  }
}

// 取一个非 default 的文件夹作为移动目标
const folders = await api('/api/folder/list')
const target = (folders || []).find(f => f.id && f.id !== 'default')
if (!target) {
  console.error('没有除 default 外的文件夹可用于移动测试')
  process.exit(1)
}
console.log(`移动目标：${target.id} (${target.name})\n`)

// ══ 用例 A：不移动，直接永久删除 ══
console.log('── A. 原地删除 ──')
const a = await createSheet('__trash验证 A 原地')
const aKey = a.pages[0].key
const aDir = path.join(FILES, 'default', a.id)
check('A 创建后本地目录存在', dirExists(aDir), aDir)
check('A 图片可访问', (await fileStillReachable(aKey)).alive)

await postJSON('/api/text/delete', { id: a.id })
check('A 软删除后文件仍在（回收站可恢复）', dirExists(aDir) && (await fileStillReachable(aKey)).alive)

await postJSON('/api/recycle/permanent', { id: a.id, kind: 'text' })
check('A 永久删除后本地目录已移走', !dirExists(aDir))
const aRest = await fileEventuallyGone(aKey)
check('A 永久删除后图片两边都取不到', !aRest.alive,
  `HTTP ${aRest.status}${aRest.status === 302 ? '（R2 对象未删）' : aRest.status === 200 ? '（本地文件未搬）' : ''}`)
check('A 垃圾箱里有归档目录', readdirSync(TRASH).some(n => n.includes(a.id)))

// ══ 用例 B：移动到别的文件夹后再删除（本次修复的核心）══
console.log('\n── B. 移动后删除 ──')
const b = await createSheet('__trash验证 B 移动')
const bKey = b.pages[0].key
const oldDir = path.join(FILES, 'default', b.id)
const newDir = path.join(FILES, target.id, b.id)
check('B 创建后目录在 default', dirExists(oldDir))

await postJSON('/api/text/move', { id: b.id, folder: target.id })
const listed = await api(`/api/text/list?folder=${encodeURIComponent(target.id)}`)
check('B 移动后出现在目标文件夹', (listed || []).some(x => x.id === b.id))
check('B 物理目录仍留在旧 folder（key 不能改，设计如此）', dirExists(oldDir) && !dirExists(newDir))

await postJSON('/api/text/delete', { id: b.id })
await postJSON('/api/recycle/permanent', { id: b.id, kind: 'text' })
check('B 永久删除后旧 folder 目录已清空（修复点）', !dirExists(oldDir), oldDir)
check('B 目标 folder 下也没有残留', !dirExists(newDir))
const bRest = await fileEventuallyGone(bKey)
check('B 永久删除后图片两边都取不到（修复点）', !bRest.alive,
  `HTTP ${bRest.status}${bRest.status === 302 ? '（R2 对象未删）' : bRest.status === 200 ? '（本地文件未搬）' : ''}`)
check('B 垃圾箱里有归档目录', readdirSync(TRASH).some(n => n.includes(b.id)))

// 清理
dropTrashOf(a.id)
dropTrashOf(b.id)

const failed = results.filter(r => !r.ok)
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
if (cleanupFailed) {
  console.log(`提示：${cleanupFailed} 个测试归档未能清理（安全删除保护），用 CODEBUDDY_SAFE_DELETE_ENABLED=0 重跑可自动清掉`)
}
if (failed.length) {
  console.log('失败项：' + failed.map(f => f.name).join(' / '))
  process.exitCode = 1
}
