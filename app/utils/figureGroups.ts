/**
 * 把「连续的、只含一张图的段落」合成一个图组，横向并排。
 *
 * 为什么需要：同一页教材常被切成三四块分别插入，markdown 里就是一串独立的
 * `![](url)`，各占一个 `<p>`。`.para-text img { max-width:100% }` 让每张按原宽
 * 独占一行，三张竖切书页（宽高比 0.6~0.8）就是三屏高 —— 用户看到的"竖向排列、
 * 特别长"。
 *
 * 现在阅读页的段落配图统一是**缩略图**（132px 框），所以并排不再有"每张只剩
 * 290px 细节全丢"的问题：阅读页调用时传 `Infinity`，横图竖图一律合成一条缩略图条
 * （否则三张横图会一条条堆成竖列，右边空一大片）。MarkdownRenderer 那种按原尺寸
 * 渲染的场景仍用默认的 `maxRatio`，明显横的图不合并 —— 三张 16:9 并排每张只剩
 * 290px 宽，细节全丢，不如维持原样。
 *
 * 幂等：已入组的 `<p>` 带 `.md-figure`，靠 closest 排除，可重复调用。
 */

const FIG_WRAP_CLASS = 'md-figure-group'
const FIG_P_CLASS = 'md-figure'

/**
 * 纯图片段落：只有一个 img 子节点、没有其它文字。
 *
 * 注意 `<img>` 外面可能已经被 `decorateParaImages` 包了一层
 * `span[data-img-wrap]`（为了放 hover 删除按钮），两种形态都要认。
 * 两个后处理函数谁先跑取决于 MutationObserver 的触发顺序，不能假设。
 *
 * 判据不能只看 `textContent` —— wrapper 里的删除按钮文字是「×」，
 * 会让纯图片段落被误判成"有文字"，图组就永远合并不了。
 * 所以按直接子节点数判断，忽略空白文本节点。
 */
function isImageParagraph(el: Element): el is HTMLParagraphElement {
  if (el.tagName !== 'P') return false
  if (el.closest(`.${FIG_WRAP_CLASS}`)) return false

  const nodes = Array.from(el.childNodes).filter(
    (n) => !(n.nodeType === Node.TEXT_NODE && !(n.textContent || '').trim()),
  )
  if (nodes.length !== 1) return false

  const only = nodes[0]
  if (only.nodeType !== Node.ELEMENT_NODE) return false
  const node = only as Element
  if (node.tagName === 'IMG') return true
  if (node.tagName === 'SPAN' && node.hasAttribute('data-img-wrap')) {
    return !!node.querySelector('img')
  }
  return false
}

/** 把同一父节点下**相邻**的图片段落切成一串串 */
function splitRuns(list: HTMLParagraphElement[]): HTMLParagraphElement[][] {
  const runs: HTMLParagraphElement[][] = []
  let run: HTMLParagraphElement[] = []
  for (const p of list) {
    const prev = run[run.length - 1]
    if (prev && prev.nextElementSibling === p) run.push(p)
    else {
      if (run.length) runs.push(run)
      run = [p]
    }
  }
  if (run.length) runs.push(run)
  return runs
}

function markGroup(group: HTMLParagraphElement[]) {
  const wrap = document.createElement('div')
  wrap.className = FIG_WRAP_CLASS
  // 列数 = 张数（最多 4）：等分栏宽，图片在自己的格子里等比缩放
  wrap.style.setProperty('--md-fig-cols', String(Math.min(group.length, 4)))
  group[0].before(wrap)
  for (const p of group) {
    p.classList.add(FIG_P_CLASS)
    wrap.appendChild(p)
  }
}

/**
 * 在 root 内执行分组。返回本次新建的图组数量。
 * `maxRatio`：整组平均宽高比达到它就不合并。阅读页传 `Infinity`（缩略图不分横竖）。
 * 图片尚未解码时会挂一次性 load 监听，加载完成后自动重试。
 */
export function applyFigureGroups(root: ParentNode, maxRatio = 1.1): number {
  const paras = Array.from(root.querySelectorAll('p')).filter(isImageParagraph)
  if (paras.length < 2) return 0

  const byParent = new Map<Element, HTMLParagraphElement[]>()
  for (const p of paras) {
    const parent = p.parentElement
    if (!parent) continue
    const arr = byParent.get(parent)
    if (arr) arr.push(p)
    else byParent.set(parent, [p])
  }

  let created = 0
  for (const list of byParent.values()) {
    for (const group of splitRuns(list)) {
      if (group.length < 2) continue
      const imgs = group.map((p) => p.querySelector('img') as HTMLImageElement)
      const unknown = imgs.filter((i) => !i.naturalWidth || !i.naturalHeight)

      if (unknown.length) {
        for (const i of unknown) {
          if (i.dataset.figWatch) continue
          i.dataset.figWatch = '1'
          i.addEventListener('load', () => applyFigureGroups(root, maxRatio), { once: true })
        }
        continue
      }

      const avg = imgs.reduce((s, i) => s + i.naturalWidth / i.naturalHeight, 0) / imgs.length
      if (avg >= maxRatio) continue

      markGroup(group)
      created++
    }
  }
  return created
}
