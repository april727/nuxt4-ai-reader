/**
 * 图片试卷的数据契约。
 *
 * 独立成文件的原因：`<script setup>` 不允许 ES 导出，类型若写在组件内，
 * 其他组件引用会报错；集中从这里引用也保证画布与列表的编号规则一致。
 */

export interface SheetPage {
  id: string
  url: string
  w: number
  h: number
  /**
   * 答案遮挡区（归一化坐标，0~1）。
   *
   * 存在页上而不是标注里：遮挡是「这张纸的属性」，跟标了几道题无关；
   * 混进 annotations 会被错题本、面板统计、编号全部当成一条标注。
   */
  covers?: SheetBBox[]
}

export interface SheetAnno {
  id: string
  pageId: string
  kind: string
  bbox: { x: number; y: number; w: number; h: number }
  note?: string
  createdAt?: string
}

export type SheetBBox = SheetAnno['bbox']

/** 四类标注：颜色与命名全局唯一来源，避免画布/面板/顶栏三处不一致 */
export const SHEET_KINDS = [
  { k: 'wrong', label: '错题', color: '#a32d2d', wash: 'rgba(163,45,45,0.08)' },
  { k: 'key', label: '重点', color: '#ba7517', wash: 'rgba(186,117,23,0.09)' },
  { k: 'q', label: '题目', color: '#5b57c4', wash: 'rgba(91,87,196,0.07)' },
  { k: 'doubt', label: '存疑', color: '#378add', wash: 'rgba(55,138,221,0.08)' },
  { k: 'note', label: '批注', color: '#0f6e56', wash: 'rgba(15,110,86,0.08)' },
] as const

export function sheetKindMeta(kind: string) {
  return SHEET_KINDS.find(m => m.k === kind) || SHEET_KINDS[1]
}
