<script setup lang="ts">
/**
 * 阅读赛道（GameRail）
 *
 * 把文章区与右侧解释区之间那条原本闲置的分隔缝，改造成一条竖向滚动的
 * 2D 俯视赛车赛道：路面自上而下卷动，玩家车在底部，随阅读进度前进。
 *
 * 设计要点
 * ─────────
 * 1. 竖条天生又窄又长（默认 56px 宽、满高），正好适配「竖向卷轴」玩法，
 *    无需横向空间，横向留给阅读与解释。
 * 2. 里程 = 已读段落数。阅读推进 → 车前进，这是竖条与阅读行为的唯一耦合点，
 *    不引入干扰。
 * 3. 障碍物 = 未标记的生词。撞到不掉血、只减速掉分，避免惩罚感干扰阅读；
 *    主动收集（撞标记过的词）会加速，形成「读得越细、跑得越快」的软激励。
 * 4. 纯前端 Canvas 视觉原型，零后端依赖，随时可整体移除。
 * 5. prefers-reduced-motion 时默认静止（不滚动），尊重阅读场景。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  /** 当前段落下标（0 起） */
  currentParaIdx: number
  /** 全文段数 */
  totalParas: number
  /** 当前段落已标记的生词数（用于加收集物） */
  markedCount?: number
  /** 移动端隐藏 */
  hidden?: boolean
}>(), { markedCount: 0, hidden: false })

/** 展开态：点击浮出统计小面板 */
const expanded = ref(false)

const canvasEl = ref<HTMLCanvasElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)

const LANES = 3
const ROAD_W = 56// 道路逻辑宽度（px，与 CSS 宽度对应）
const CAR_W = 13
const CAR_H = 20
const OBST_W = 13// 障碍车宽（与玩家车同宽，保持视觉统一）
const OBST_H = 18

// ── 游戏状态 ───────────────────────────────────────────
const lane = ref(1)            // 当前车道 0..2
const speed = ref(0)           // 当前速度 px/s
const distance = ref(0)        // 行驶距离（分数）
const coins = ref(0)           // 收集的标记数
const hits = ref(0)            // 撞到的生词数
const best = ref(0)            // 历史最佳
/** 视觉抖动：撞到障碍时的短暂位移 */
const shake = ref(0)
/** 撞到障碍后的减速剩余时间 */
const slowUntil = ref(0)

interface Obstacle { lane: number; y: number; kind: 'word' | 'mark'; alive: boolean }
const obstacles = ref<Obstacle[]>([])

/** 里程显示：每 10 段 = 1 圈 */
const lap = computed(() => Math.floor(distance.value / 1000) + 1)
const progressPct = computed(() => {
  if (!props.totalParas) return 0
  return Math.min(100, Math.round(((props.currentParaIdx + 1) / props.totalParas) * 100))
})

const stats = computed(() => [
  { k: '里程', v: String(Math.round(distance.value)) },
  { k: '圈数', v: String(lap.value) },
  { k: '标记', v: String(coins.value) },
  { k: '撞词', v: String(hits.value) },
])

// ── Canvas 渲染 ────────────────────────────────────────
let raf = 0
let lastTs = 0
let spawnAcc = 0
let roadOffset = 0
let dpr = 1
let cssW = ROAD_W
let cssH = 400
let ctx: CanvasRenderingContext2D | null = null
const reduceMotion = ref(false)

function resize() {
  const cv = canvasEl.value
  if (!cv) return
  const rect = cv.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  cssW = rect.width
  cssH = rect.height
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  cv.width = Math.round(cssW * dpr)
  cv.height = Math.round(cssH * dpr)
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function laneCenter(i: number) {
  const usable = cssW - 8
  return 4 + (usable / LANES) * (i + 0.5)
}

/** 目标速度：基础速度 + 标记加成，读得越细越快 */
function targetSpeed(nowTs: number) {
  if (reduceMotion.value) return 0
  let v = 46 + props.markedCount * 3
  if (nowTs < slowUntil.value) v *= 0.45
  return Math.min(150, v)
}

function spawn() {
  const kind = Math.random() < 0.34 ? 'mark' : 'word'
  const l = Math.floor(Math.random() * LANES)
  obstacles.value.push({ lane: l, y: -OBST_H - 2, kind, alive: true })
}

function tick(ts: number) {
  raf = requestAnimationFrame(tick)
  if (!lastTs) lastTs = ts
  const dt = Math.min(0.05, (ts - lastTs) / 1000)
  lastTs = ts

  resizeIfNeeded()

  const target = targetSpeed(ts)
  speed.value += (target - speed.value) * Math.min(1, dt * 4)
  const dy = speed.value * dt

  distance.value += dy * 0.42
  if (distance.value > best.value) best.value = Math.floor(distance.value)

  if (speed.value > 0) {
    roadOffset = (roadOffset + dy) % 40

    spawnAcc += dt
    const gap = Math.max(0.42, 0.95 - speed.value / 260)
    while (spawnAcc > gap) {
      spawnAcc -= gap
      spawn()
    }

    const carY = cssH - CAR_H - 10
    for (const o of obstacles.value) {
      o.y += dy
      if (!o.alive) continue
      // 碰撞判定（垂直区间重叠 + 横向车道距离）
      const halfH = (CAR_H + OBST_H) / 2 - 3
      if (Math.abs(o.y + OBST_H / 2 - (carY + CAR_H / 2)) < halfH
        && Math.abs(laneCenter(o.lane) - laneCenter(lane.value)) < 11) {
        o.alive = false
        if (o.kind === 'mark') {
          coins.value++
          speed.value = Math.min(150, speed.value + 12)
        } else {
          hits.value++
          shake.value = 1
          slowUntil.value = ts + 700
        }
      }
      if (o.y > cssH + 16) o.alive = false
    }
    obstacles.value = obstacles.value.filter(o => o.alive)
  } else {
    speed.value = 0
  }

  if (shake.value > 0) shake.value = Math.max(0, shake.value - dt * 4)

  draw()
}

let lastW = 0
let lastH = 0
function resizeIfNeeded() {
  const cv = canvasEl.value
  if (!cv) return
  const rect = cv.getBoundingClientRect()
  if (Math.abs(rect.width - lastW) > 0.5 || Math.abs(rect.height - lastH) > 0.5) {
    lastW = rect.width
    lastH = rect.height
    resize()
  }
}

function draw() {
  if (!ctx) return
  const w = cssW
  const h = cssH
  ctx.clearRect(0, 0, w, h)

  const shakeX = shake.value > 0 ? Math.sin(shake.value * 34) * shake.value * 2.4 : 0

  // 路面
  ctx.fillStyle = '#20232a'
  ctx.fillRect(0, 0, w, h)

  // 边线（黄）
  ctx.fillStyle = '#c9a227'
  ctx.fillRect(1.5, 0, 1.5, h)
  ctx.fillRect(w - 3, 0, 1.5, h)

  // 车道虚线（白）
  ctx.fillStyle = '#e8ecf1'
  for (let l = 1; l < LANES; l++) {
    const x = Math.round(4 + ((w - 8) / LANES) * l) - 0.75
    for (let y = roadOffset; y < h; y += 40) ctx.fillRect(x, y, 1.5, 20)
  }

  // 起点棋盘格（随滚动推移，营造前进感）
  ctx.fillStyle = '#e8ecf1'
  const chkY = ((roadOffset * 0.5) % 80) + h - 60
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      if ((r + c) % 2 === 0) ctx.fillRect(4 + c * 12, chkY + r * 12, 12, 12)
    }
  }

  // 障碍 / 收集物（画成小车造型，避免方块看起来像白块）
  for (const o of obstacles.value) {
    drawCar(o.lane, o.y, o.kind === 'mark' ? '#3C3489' : '#6b6963', o.kind === 'mark' ? '#CECBF6' : '#a09e97')
  }

  // 玩家车
  drawCar(lane.value, h - CAR_H - 10, '#E24B4A', '#B5D4F4', shakeX)
}

/** 画一辆俯视小车：车身 + 车窗 + 四轮 */
function drawCar(laneIdx: number, y: number, body: string, glass: string, offsetX = 0) {
  if (!ctx) return
  const cx = laneCenter(laneIdx) + offsetX
  const w = OBST_W
  const hgt = OBST_H
  const x = cx - w / 2
  // 车轮（深色，先画，让车身压在上面）
  ctx.fillStyle = '#14161a'
  ctx.fillRect(x - 1, y + 2, 1, 4)
  ctx.fillRect(x + w, y + 2, 1, 4)
  ctx.fillRect(x - 1, y + hgt - 6, 1, 4)
  ctx.fillRect(x + w, y + hgt - 6, 1, 4)
  // 车身
  ctx.fillStyle = body
  ctx.fillRect(x, y, w, hgt)
  // 车窗
  ctx.fillStyle = glass
  ctx.fillRect(x + 2, y + 2.5, w - 4, 3)
}

// ── 交互 ───────────────────────────────────────────────
function steer(dir: -1 | 1) {
  lane.value = Math.max(0, Math.min(LANES - 1, lane.value + dir))
}

function onKey(e: KeyboardEvent) {
  if (!isActive.value) return
  if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') { steer(-1); e.preventDefault() }
  if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') { steer(1); e.preventDefault() }
}

const isActive = computed(() => !props.hidden && !!canvasEl.value)

function onPointer(e: PointerEvent) {
  if (!canvasEl.value) return
  const rect = canvasEl.value.getBoundingClientRect()
  const x = e.clientX - rect.left
  const usable = rect.width - 8
  lane.value = Math.max(0, Math.min(LANES - 1, Math.floor((x - 4) / (usable / LANES))))
}

onMounted(() => {
  reduceMotion.value = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  ctx = canvasEl.value?.getContext('2d') || null
  resize()
  if (typeof best.value !== 'number' || !best.value) {
    best.value = Number(localStorage.getItem('reading-race-best') || 0)
  }
  raf = requestAnimationFrame(tick)
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('keydown', onKey)
  if (typeof window !== 'undefined' && Number.isFinite(best.value)) {
    localStorage.setItem('reading-race-best', String(Math.floor(best.value)))
  }
})

// 页面隐藏时停帧，回来再续
function onVisibility() {
  if (document.hidden) {
    cancelAnimationFrame(raf)
    raf = 0
  } else if (!raf) {
    lastTs = 0
    raf = requestAnimationFrame(tick)
  }
}
onMounted(() => document.addEventListener('visibilitychange', onVisibility))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisibility))

// 阅读进度推进 → 里程奖励
watch(() => props.currentParaIdx, (n, o) => {
  if (n > (o ?? -1)) {
    distance.value += 14
    if (props.markedCount > 0) coins.value += 0
  }
})
</script>

<template>
  <div
    v-if="!hidden"
    class="game-rail"
    :class="{ expanded }"
    ref="panelEl"
  >
    <div class="rail-track" @click="expanded = !expanded" :title="expanded ? '收起赛道' : '展开赛道数据'">
      <canvas
        ref="canvasEl"
        class="rail-canvas"
        @pointerdown.stop="onPointer"
        @pointermove="onPointer"
      />
      <div class="rail-speed">
        <span class="rail-speed-num">{{ Math.round(speed) }}</span>
        <span class="rail-speed-unit">km/h</span>
      </div>
      <div class="rail-lap">L{{ lap }}</div>
    </div>

    <transition name="rail-pop">
      <div v-if="expanded" class="rail-popover">
        <div class="rail-pop-head">
          <span>阅读赛道</span>
          <button class="rail-close" @click="expanded = false" aria-label="关闭">×</button>
        </div>
        <div class="rail-stat-grid">
          <div v-for="s in stats" :key="s.k" class="rail-stat">
            <span class="rail-stat-k">{{ s.k }}</span>
            <span class="rail-stat-v">{{ s.v }}</span>
          </div>
        </div>
        <div class="rail-progress">
          <div class="rail-progress-bar" :style="{ width: progressPct + '%' }" />
        </div>
        <div class="rail-progress-text">{{ progressPct }}% · 第 {{ currentParaIdx + 1 }}/{{ totalParas }} 段</div>
        <div class="rail-hint">
          读得越快车跑越远，标记生词可加速，撞到生词会减速。<br>
          左右方向键或点击赛道变道。最佳里程 {{ best }}。
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.game-rail {
  position: relative;
  flex-shrink: 0;
  width: 56px;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: #20232a;
  border-right: 0.5px solid rgba(0, 0, 0, 0.2);
}

.rail-track {
  position: relative;
  width: 100%;
  flex: 1;
  cursor: pointer;
  touch-action: none;
}

.rail-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.rail-speed {
  position: absolute;
  left: 0;
  right: 0;
  top: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  pointer-events: none;
  font-family: 'DM Mono', monospace;
  background: rgba(32, 35, 42, 0.72);
  padding: 4px 0;
  border-radius: 0 0 8px 8px;
}

.rail-speed-num {
  font-size: 13px;
  font-weight: 500;
  color: #e8ecf1;
  line-height: 1.1;
}

.rail-speed-unit {
  font-size: 9px;
  color: #8a8880;
  line-height: 1;
}

.rail-lap {
  position: absolute;
  left: 0;
  right: 0;
  top: 50px;
  text-align: center;
  font-family: 'DM Mono', monospace;
  font-size: 10px;
  color: #c9a227;
  pointer-events: none;
  background: rgba(32, 35, 42, 0.72);
  padding: 1px 0;
}

.rail-popover {
  position: absolute;
  right: calc(100% + 8px);
  top: 8px;
  width: 216px;
  padding: 12px 14px;
  background: #f7f6f3;
  border: 0.5px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  color: #1a1a18;
  z-index: 60;
  font-family: 'DM Sans', sans-serif;
}

.rail-pop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 10px;
}

.rail-close {
  border: 0;
  background: transparent;
  font-size: 16px;
  line-height: 1;
  color: #8a8880;
  cursor: pointer;
  padding: 0 2px;
}

.rail-stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 12px;
}

.rail-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rail-stat-k {
  font-size: 11px;
  color: #8a8880;
}

.rail-stat-v {
  font-size: 15px;
  font-weight: 500;
  font-family: 'DM Mono', monospace;
  color: #1a1a18;
}

.rail-progress {
  height: 4px;
  border-radius: 2px;
  background: #e3e3e3;
  overflow: hidden;
}

.rail-progress-bar {
  height: 100%;
  background: #3d3591;
  transition: width 0.3s;
}

.rail-progress-text {
  margin-top: 6px;
  font-size: 11px;
  color: #6b6963;
}

.rail-hint {
  margin-top: 10px;
  font-size: 11px;
  line-height: 1.6;
  color: #8a8880;
}

.rail-pop-enter-active,
.rail-pop-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}

.rail-pop-enter-from,
.rail-pop-leave-to {
  opacity: 0;
  transform: translateX(6px);
}
</style>