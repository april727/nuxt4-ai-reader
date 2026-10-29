/**
 * 临时截图工具（调试用）：把某个站内路径截成 png。
 *
 *   node server/scripts/shot.mjs "/read/txt_xxx" out.png
 *   SHOT_JS='document.querySelector(".pim").scrollIntoView()' node server/scripts/shot.mjs /read/xxx a.png
 *   SHOT_W=390 SHOT_H=844 node server/scripts/shot.mjs /read/xxx mobile.png   # 模拟手机
 *
 * 注意：在 Git Bash 里传以 / 开头的路径要加 MSYS_NO_PATHCONV=1，
 * 否则 MSYS 会把 "/read/xxx" 当成 Unix 路径转换成 "F:/.../PortableGit/read/xxx"。
 */
import { writeFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { launchChrome, resolveBase, sleep, waitFor } from './lib/cdp.mjs'

const target = process.argv[2] || '/'
const out = process.argv[3] || 'shot.png'

const env = readFileSync('.env', 'utf8').split(/\r?\n/).reduce((a, l) => {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) a[m[1]] = m[2].replace(/^["']|["']$/g, '')
  return a
}, {})
const token = createHash('sha256').update(env.SITE_PASSWORD || '').digest('hex')

const base = await resolveBase()
const b = await launchChrome({ port: 9444, profile: 'server/data/.tmp-shot', base, token })
try {
  if (process.env.SHOT_W) {
    await b.send('Emulation.setDeviceMetricsOverride', {
      width: Number(process.env.SHOT_W),
      height: Number(process.env.SHOT_H || 844),
      deviceScaleFactor: 2,
      mobile: true,
    })
  }
  if (process.env.SHOT_NOCACHE) {
    // 量「冷启动」传输量时必须关缓存，否则全是 disk cache 命中，统计里只剩零星几个
    await b.send('Network.clearBrowserCache')
    await b.send('Network.setCacheDisabled', { cacheDisabled: true })
  }
  console.log('navigate to:', base + target)
  await b.goto(base + target)
  await sleep(1500)
  // dev 首屏要等 Vite 编译 + 大图解码，等到正文出现再继续（最多 30s）
  await waitFor(async () => {
    const n = await b.evalInPage('document.querySelectorAll(".para-block").length').catch(() => 0)
    return n > 0
  }, { timeout: 30000, label: '正文段落出现' }).catch(() => console.log('warn: 正文未出现'))
  await sleep(1500)
  if (process.env.SHOT_JS) {
    console.log('eval:', await b.evalInPage(process.env.SHOT_JS))
    await sleep(Number(process.env.SHOT_GAP || 1200))
  }
  // 第二步：通常用来在「滚动/点击之后」再读状态（图片是 lazy 的，滚过去才开始加载）
  if (process.env.SHOT_JS2) {
    console.log('eval2:', await b.evalInPage(process.env.SHOT_JS2))
    await sleep(600)
  }
  const { data } = await b.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(out, Buffer.from(data, 'base64'))
  console.log('saved', out)
} finally {
  await b.close()
}
