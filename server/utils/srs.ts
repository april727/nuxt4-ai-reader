/**
 * 间隔重复调度（唯一算法来源）
 *
 * 之前评分逻辑写在前端：learn 阶段从不写 nextReview，导致「到期」永远为空，
 * 卡片只能一次拉全部词。现在统一放到服务端，前端只提交 grade。
 *
 * 规则：
 *  - 学习阶段：连续答对 3 次毕业（10 分钟 → 1 天 → 1 天），期间答错回到第 1 步
 *  - 「简单」直接毕业，间隔 4 天
 *  - 复习阶段：again 降 ease 并 10 分钟后重来；hard ×1.2；good ×ease；easy ×ease×1.3
 *  - 间隔 ≥ 21 天视为已掌握
 */

export type Grade = 'again' | 'hard' | 'good' | 'easy'

export interface SrsState {
  phase: string
  learnCorrect: number
  learnTotal: number
  learnWrong: number
  ease: number
  interval: number
  repetitions: number
  nextReview: string
  reviewCount?: number
  lapses?: number
  lastReviewedAt?: string
}

const LEARN_STEPS_SEC = [600, 86_400] // 第 1 次答对 10 分钟，第 2 次 1 天
const RELEARN_SEC = 600
const EASY_GRADUATE_DAYS = 4
const MASTERED_INTERVAL_DAYS = 21

const DAY = 86_400_000

function clampEase(v: number): number {
  return Math.min(3.2, Math.max(1.3, Number(v.toFixed(2))))
}

/** 根据评分计算新的调度状态（纯函数，便于测试） */
export function applyGrade(word: SrsState, grade: Grade, now = new Date()): SrsState {
  let phase = word.phase || 'learn'
  if (phase === 'mastered') phase = 'review' // 已掌握的词再次出现时回到复习

  let learnCorrect = word.learnCorrect || 0
  let learnTotal = (word.learnTotal || 0) + 1
  let learnWrong = word.learnWrong || 0
  let ease = clampEase(word.ease || 2.5)
  let interval = word.interval || 0
  let repetitions = word.repetitions || 0
  const reviewCount = (word.reviewCount || 0) + 1
  let lapses = word.lapses || 0

  let next = now.getTime()

  if (phase === 'learn') {
    if (grade === 'again') {
      learnWrong++
      learnCorrect = 0
      next += RELEARN_SEC * 1000
    } else if (grade === 'hard') {
      // 停在当前步骤，10 分钟后再来
      next += RELEARN_SEC * 1000
    } else if (grade === 'good') {
      learnCorrect++
      if (learnCorrect >= 3) {
        phase = 'review'
        interval = 1
        repetitions = Math.max(1, repetitions + 1)
        next += DAY
      } else {
        const stepSec = LEARN_STEPS_SEC[Math.min(learnCorrect - 1, LEARN_STEPS_SEC.length - 1)]
        next += stepSec * 1000
      }
    } else {
      // easy：直接毕业
      phase = 'review'
      interval = EASY_GRADUATE_DAYS
      repetitions = Math.max(1, repetitions + 1)
      ease = clampEase(ease + 0.15)
      next += interval * DAY
    }
  } else {
    if (grade === 'again') {
      lapses++
      learnWrong++
      ease = clampEase(ease - 0.2)
      interval = 1
      repetitions = 0
      next += RELEARN_SEC * 1000
    } else {
      const base = Math.max(interval, 1)
      if (grade === 'hard') {
        interval = Math.max(1, Math.round(base * 1.2))
        ease = clampEase(ease - 0.15)
      } else if (grade === 'good') {
        interval = Math.max(1, Math.round(base * ease))
      } else {
        interval = Math.max(1, Math.round(base * ease * 1.3))
        ease = clampEase(ease + 0.15)
      }
      repetitions++
      next += interval * DAY
      if (interval >= MASTERED_INTERVAL_DAYS) phase = 'mastered'
    }
  }

  return {
    phase,
    learnCorrect,
    learnTotal,
    learnWrong,
    ease,
    interval,
    repetitions,
    nextReview: new Date(next).toISOString(),
    reviewCount,
    lapses,
    lastReviewedAt: now.toISOString(),
  }
}

/** 是否到期（新词也算到期，nextReview 为空） */
export function isDue(word: { phase: string; nextReview?: string }, now = new Date()): boolean {
  if (word.phase === 'mastered') return false
  if (!word.nextReview) return true
  return new Date(word.nextReview).getTime() <= now.getTime()
}
