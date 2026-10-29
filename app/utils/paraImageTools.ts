/**
 * 段落里 markdown 图片的可视化操作层。
 *
 * 背景：`.para-text` 是 `v-html` 渲染的字符串，图片是 `![](url)` 产生的
 * `<img>`，没有组件包裹 —— 想给图片加一个 hover 删除按钮，只能做 DOM 后处理。
 *
 * 为什么必须包 wrapper：`<img>` 不能有子元素，`position: absolute` 的按钮
 * 只能相对某个祖先定位。直接相对 `.para-text` 定位会让按钮跑到段落右上角，
 * 而不是图片右上角（段落里有文字时更错位）。
 *
 * 幂等：处理过的 img 打 `data-img-ready`，wrapper 打 `data-img-wrap`。
 * v-html 重渲染会整体替换 innerHTML，新 img 没有标记，会重新处理。
 */

const WRAP_CLASS = 'para-img-wrap'
const BTN_CLASS = 'para-img-del'

/** 给段落里的每张 markdown 图片加 wrapper + 删除按钮，返回本次处理的数量 */
export function decorateParaImages(
  root: ParentNode,
  onDelete: (img: HTMLImageElement) => void,
): number {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img:not([data-img-ready])'))
  let count = 0

  for (const img of imgs) {
    img.dataset.imgReady = '1'
    // 段落附件（ParaImages）自带删除按钮，且结构是 grid cell，不能动
    if (img.closest('.pim') || img.closest('[data-img-wrap]')) continue

    const wrap = document.createElement('span')
    wrap.className = WRAP_CLASS
    wrap.dataset.imgWrap = '1'
    img.before(wrap)
    wrap.appendChild(img)

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = BTN_CLASS
    // 只移除段落里的引用，不动磁盘上的原图：同一张图可能被别的段落/文章引用
    btn.title = '从本段移除这张图片（不删除原图文件）'
    btn.setAttribute('aria-label', '从本段移除这张图片')
    btn.textContent = '×'
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      onDelete(img)
    })
    wrap.appendChild(btn)
    count++
  }

  return count
}
