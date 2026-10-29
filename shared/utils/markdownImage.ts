/**
 * 从 markdown 文本里移除一张图片的引用。
 *
 * 前后端共用（阅读页点击图片上的 × → 服务端执行），所以放 shared：
 * 判定逻辑必须只有一份，否则"客户端认为能命中、服务端认为命中不了"
 * 会出现按钮点了没反应、或者删错了另一张图的失控情况。
 */

/** 段落里第 n 张图片对应的 markdown 片段：`![alt](url "title")` */
const MD_IMAGE_RE = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/g

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/**
 * @param text    段落原文（服务端传的是库里的最新文本，客户端传的可能是缓存，故必须服务端为准）
 * @param src     `<img>` 的 src：可能是 `/api/file/<key>`，也可能是历史数据里的裸 key / 外链
 * @param ordinal 这是段落里第几张图片，用于同一张图重复出现时删对被点的那一张
 * @returns 新文本；找不到对应标记时返回 null（让调用方提示，而不是静默清空）
 */
export function stripMarkdownImage(text: string, src: string, ordinal = 0): string | null {
  if (!text || !src) return null

  const decoded = safeDecode(src)
  // img.src 是绝对地址（http://host/api/file/key），段落里通常是 key 或 /api/file/key
  const key = decoded.includes('/api/file/') ? decoded.split('/api/file/')[1] : decoded

  const hits: Array<{ start: number; end: number }> = []
  MD_IMAGE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MD_IMAGE_RE.exec(text))) {
    const url = safeDecode(m[2])
    // 用「以 key 结尾」匹配，统一覆盖 key / 相对路径 / 绝对地址三种历史写法。
    // key 里带 img_xxx 文件名，不会误配到别的图片。
    if (url.endsWith(key) || m[2].endsWith(key)) {
      hits.push({ start: m.index, end: m.index + m[0].length })
    }
  }
  if (!hits.length) return null

  const target = hits[Math.min(ordinal, hits.length - 1)]
  let next = text.slice(0, target.start) + text.slice(target.end)
  // 图片独占一行时两侧各留一个换行，去掉多余的，避免留下大段空白
  next = next.replace(/^[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n')
  return next.trim()
}
