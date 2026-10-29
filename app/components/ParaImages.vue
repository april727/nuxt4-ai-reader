<template>
  <figure v-if="images.length" class="pim" :class="[`pim--${size}`, { 'pim--collapsed': collapsed, 'pim--single': images.length === 1, 'pim--narrow': narrow }]">
    <!-- 工具条：默认隐形，hover 图片区才浮出（移动端常显） -->
    <div class="pim-bar">
      <button class="pim-chip" type="button" @click.stop="$emit('toggle-collapse')">
        <svg class="pim-chev" :class="{ open: !collapsed }" width="10" height="10" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2.4">
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span>{{ images.length }} 张配图</span>
      </button>

      <div class="pim-sizes" role="group" aria-label="图片宽度">
        <button
          v-for="opt in SIZE_OPTS" :key="opt.v" type="button"
          class="pim-size" :class="{ active: size === opt.v }"
          :title="opt.hint" @click.stop="$emit('update:size', opt.v)"
        >{{ opt.label }}</button>
      </div>
    </div>

    <div
      v-if="!collapsed" class="pim-grid"
      :class="{ 'pim-grid--figures': figures }"
      :style="{ '--pim-cols': cols }"
    >
      <div
        v-for="(img, i) in images" :key="`${img}#${i}`"
        class="pim-cell"
        :class="{ 'pim-cell--hero': images.length === 1 }"
        :style="cellStyle"
        @click.stop="$emit('open', i)"
      >
        <img
          :src="imgSrc(img)" :srcset="srcsetOf(img)" :sizes="sizesAttr"
          :alt="`配图 ${i + 1}`"
          loading="lazy" decoding="async" draggable="false"
          @load="onLoad(img, $event)"
        >
        <span v-if="images.length > 1" class="pim-no">{{ i + 1 }}</span>
        <button class="pim-del" type="button" title="从本段移除" @mousedown.stop @click.stop="$emit('remove', img)">×</button>
      </div>
    </div>
  </figure>
</template>

<script setup lang="ts">
/**
 * 段落配图的展示层。
 *
 * 三条硬规则（都是旧实现踩过的坑）：
 * 1. **单图绝不裁切、绝不放大**：按原图像素尺寸显示，只受 max-width / max-height 约束。
 *    旧实现把任意比例的图塞进固定 160×120 + object-fit:cover —— 1776×997 的横图
 *    丢左右 25%，1200×1600 的竖图丢上下 44%，于是"一张被撑满的模糊方块"。
 * 2. **尺寸档位按栏宽而不是固定像素**：160px 这种绝对值在大屏上等于把 2.9MB 的原图
 *    缩到 1/90 显示，再清晰的原图也白费。
 * 3. **多图整组共用一个容器比例**（取首图），同一行才等高；各用各的比例会一高一矮，
 *    在网格里撕出大片空洞。
 */
const props = withDefaults(defineProps<{
  images: string[]
  paraId: string
  size?: 'sm' | 'md' | 'lg'
  collapsed?: boolean
}>(), { size: 'md', collapsed: false })

defineEmits<{
  'update:size': ['sm' | 'md' | 'lg']
  'toggle-collapse': []
  remove: [string]
  open: [number]
}>()

const SIZE_OPTS = [
  { v: 'sm' as const, label: '紧凑', hint: '窄幅：单图 320px / 多图 460px 上限' },
  { v: 'md' as const, label: '标准', hint: '按原图尺寸，最宽到文本栏宽' },
  { v: 'lg' as const, label: '通栏', hint: '出血：左右突破文本栏，适合大图/信息图' },
]

/** 列数：单图不切；2~4 张两列；5 张以上三列（避免一排挤成细条） */
const cols = computed(() => {
  const n = props.images.length
  if (n === 1) return 1
  if (n <= 4) return 2
  return 3
})

/** img 的 src：兼容存 key 与存完整 URL 两种历史数据 */
function srcOf(img: string) {
  if (!img) return ''
  if (/^(https?:)?\/\//.test(img) || img.startsWith('/') || img.startsWith('blob:') || img.startsWith('data:')) return img
  return `/api/file/${img}`
}

/** 站内图才走派生：外链/blob 直接原样返回 */
function isLocalKey(img: string) {
  return !(
    /^(https?:)?\/\//.test(img) || img.startsWith('blob:') || img.startsWith('data:') ||
    img.startsWith('/')
  )
}

/** srcset 档位与 server/utils/imageDerive.ts 的 DERIVE_WIDTHS 保持一致 */
const DERIVE_STEPS = [480, 800, 1200, 1600, 2000]

/**
 * 单图：**必须用固定档位，不能给 srcset**。
 *
 * `w` 描述符会让浏览器把资源当成「为 N 个布局像素准备的高密度图」，
 * 而单图的 img 是 `width:auto`（按原图像素显示），渲染宽度就会按 density 缩水：
 * 924px 的原图声明成 `1600w`，浏览器算出 density=1.6，最后只画 577px —— 越优化越小。
 * 固定 `?w=1600` 时 intrinsic 宽度就是 min(1600, 原宽)，与派生前完全一致。
 *
 * 多图不受影响：格子是 width:100% + object-fit:cover，img 的内在尺寸不参与布局。
 */
const SINGLE_SRC_W = 1600

function imgSrc(img: string) {
  const base = srcOf(img)
  if (props.images.length !== 1) return base
  return isLocalKey(img) ? `${base}?w=${SINGLE_SRC_W}` : base
}

/**
 * 交给浏览器按 DPR 和实际布局宽度挑一档，自己算不如它准：
 * 桌面 1x 会挑 1200（约 100KB），2x 挑 2000；手机 3x 挑 1200。
 * 全部走服务端 WebP 派生，原图（平均 2.9MB）只在灯箱里用。
 */
function srcsetOf(img: string) {
  if (!isLocalKey(img)) return undefined
  if (props.images.length === 1) return undefined // 见 imgSrc 的说明
  const base = `/api/file/${img}`
  return DERIVE_STEPS.map((w) => `${base}?w=${w} ${w}w`).join(', ')
}

/** 真实宽高比，未加载完先给 16:9 占位（照片最常见，跳变最小） */
const ratios = reactive<Record<string, number>>({})

/** 首图宽高比。同组配图通常来自同一页/同一套图，用它代表整组即可 */
const leadRatio = computed(() => ratios[props.images[0]] || 16 / 9)

/**
 * 竖图组：多图 + 首图是竖的（宽高比 < 0.85）。
 *
 * 这类图（书页竖切、手机长截图）如果沿用 grid + aspect-ratio，格子高度 = 列宽 ÷ 0.55，
 * 两列时单格接近 1200px、三张图就是三屏 —— 观感上等于"竖向排列"，每张都巨大。
 * 改成「先定高度、宽度由比例推出」：三张各约 250×450 并排一行，一屏内看完。
 */
const figures = computed(() => props.images.length > 1 && leadRatio.value < 0.85)

/**
 * sizes 必须是"图片在布局里占多宽"的诚实估计：给大了只会多下一档、白费流量，
 * 给小了浏览器挑低分辨率的档位，图片就糊 —— 这里按主栏宽约 1330px 标定。
 */
const sizesAttr = computed(() => {
  const n = props.images.length
  const mobile = '96vw'
  if (n === 1) return `(max-width: 760px) ${mobile}, 1000px`
  // 竖图组按高度封顶，宽度只有 200~280px，报 680px 会让浏览器白下一档
  if (figures.value) return `(max-width: 760px) 46vw, 280px`
  if (n <= 4) return `(max-width: 760px) 48vw, 680px`
  return `(max-width: 760px) 32vw, 450px`
})

/** 单图明显窄于栏宽时居中（靠左会出现一大片右侧空洞，版面失衡） */
const narrow = ref(false)
function onLoad(img: string, e: Event) {
  const el = e.target as HTMLImageElement
  if (!el?.naturalWidth || !el?.naturalHeight) return
  ratios[img] = el.naturalWidth / el.naturalHeight
  if (props.images.length === 1) {
    // 用**渲染宽度**判断窄图，不能用 naturalWidth：有 srcset 时 naturalWidth 是浏览器
    // 选中的那一档（可能是 800w 的派生图），而不是原图宽度，据此判断会误判成窄图。
    const grid = el.closest('.pim-grid') as HTMLElement | null
    const avail = grid?.clientWidth || 0
    const shown = el.getBoundingClientRect().width
    if (avail > 0 && shown > 0) narrow.value = shown < avail * 0.62
  }
}
function ratioOf(img: string) {
  return ratios[img] || 16 / 9
}
/**
 * 单图：不设比例，让 <img> 按自身像素尺寸显示（max-width/max-height 约束），
 * 小图不会被拉大糊掉、大图不会铺满一屏。
 *
 * 多图：**整组共用一个比例**（取首图），同一行才等高。若各用各的比例，
 * 一横一竖并排就会一高一矮，右侧留一片空洞 —— 那正是"粗糙"观感的来源之一。
 */
const cellStyle = computed(() => {
  if (props.images.length === 1) return {}
  return { aspectRatio: String(ratioOf(props.images[0])) }
})
</script>

<style scoped>
.pim {
  margin: 12px 0 2px;
  position: relative;
}

/* ── 工具条 ── */
.pim-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 0;
  opacity: 0;
  transition: opacity 0.16s ease;
  padding: 0 2px 6px;
}
.pim:hover .pim-bar,
.pim:focus-within .pim-bar { opacity: 1; }
.pim--collapsed .pim-bar { opacity: 1; }

.pim-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  cursor: pointer;
  padding: 2px 6px 2px 4px;
  border-radius: 5px;
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 11px;
  letter-spacing: 0.02em;
  color: #9c9a93;
}
.pim-chip:hover { color: #3f3d38; background: #f2f1ec; }
.pim-chev { transition: transform 0.18s ease; }
.pim-chev.open { transform: rotate(180deg); }

.pim-sizes { display: inline-flex; gap: 1px; }
.pim-size {
  border: none;
  background: none;
  cursor: pointer;
  padding: 2px 7px;
  border-radius: 5px;
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 10.5px;
  color: #b3b1aa;
  transition: color 0.14s, background 0.14s;
}
.pim-size:hover { color: #3f3d38; background: #f2f1ec; }
.pim-size.active { color: #3d3591; background: rgba(61, 53, 145, 0.07); }

/* ── 网格 ── */
.pim-grid {
  display: grid;
  grid-template-columns: repeat(var(--pim-cols, 1), minmax(0, 1fr));
  gap: 9px;
  align-items: start;
}

.pim-cell {
  position: relative;
  overflow: hidden;
  border-radius: 7px;
  background: #f2f1ec;
  cursor: zoom-in;
  /* 只画一圈极淡的内描边，不用阴影——大量图片叠加阴影会显脏 */
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.055);
  transition: box-shadow 0.16s ease, transform 0.16s ease;
}
.pim-cell:hover {
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.1), 0 4px 16px rgba(0, 0, 0, 0.09);
}
.pim-cell img {
  display: block;
  width: 100%;
  height: 100%;
  /* 容器用整组首图的比例，横竖混排时靠 cover 补齐；点开灯箱可看全 */
  object-fit: cover;
  user-select: none;
}

/* ── 单图：按原图像素尺寸显示，宁小不大（放大必糊），高度上限避免吃掉一屏 ── */
.pim--single .pim-grid { justify-items: start; }
/* 窄图居中：小插图靠左会留一大片右侧空白，居中更平衡（紧凑档除外，它本来就窄） */
.pim--single.pim--narrow:not(.pim--sm) .pim-grid { justify-items: center; }
.pim--single .pim-cell {
  width: fit-content;
  max-width: 100%;
  background: none;
  box-shadow: none;
  border-radius: 7px;
}
.pim--single .pim-cell:hover { box-shadow: none; }
.pim--single .pim-cell img {
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 60vh;
  border-radius: 7px;
  outline: 1px solid rgba(0, 0, 0, 0.06);
  outline-offset: -1px;
  transition: outline-color 0.15s;
}
.pim--single .pim-cell:hover img { outline-color: rgba(61, 53, 145, 0.28); }

/* 单张图：不再铺满整幅，按档位控宽，避免"一张图吃掉一屏" */
.pim--sm .pim-grid { max-width: 460px; }
.pim--sm.pim--single .pim-grid { max-width: 320px; }
.pim--md .pim-grid { max-width: 100%; }
.pim--lg .pim-grid { width: calc(100% + 72px); margin-inline: -36px; max-width: none; }

/* ── 竖图组：按高度排，不按宽度排 ──
   书页竖切 / 长截图的宽高比常在 0.5~0.65。若沿用 grid 的 aspect-ratio，
   单格高度 = 列宽 ÷ 0.55（两列时接近 1200px），三张就是三屏，等于"竖向排列"。
   改成 flex 等高横排：高度由档位封顶，宽度按比例自然推出（约 200~280px），
   三张并排一行、一屏内看完；要看整页细节点开灯箱。 */
.pim-grid--figures {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: flex-start;
  gap: 9px;
}
.pim-grid--figures .pim-cell {
  flex: 0 0 auto;
  width: auto;
  /* 大屏兜底：54vh 在 1440p 上会到 780px，超过 520 就停，别又变回"一屏一张" */
  height: min(var(--pim-fig-h, 44vh), 520px);
}
/* 档位对竖图组是"高度档"：紧凑更矮、通栏更高，不再是宽度上限 */
.pim--sm .pim-grid--figures { max-width: none; --pim-fig-h: 32vh; }
.pim--md .pim-grid--figures { --pim-fig-h: 44vh; }
.pim--lg .pim-grid--figures { --pim-fig-h: 54vh; }

/* 单图的高度约束由 .pim--single .pim-cell img 的 max-height 负责 */

/* 序号角标：多图时告诉读者"这是第几张"，也让点击目标更明确 */
.pim-no {
  position: absolute;
  left: 7px;
  bottom: 7px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.42);
  color: #fff;
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 10px;
  line-height: 17px;
  text-align: center;
  backdrop-filter: blur(4px);
  pointer-events: none;
}

.pim-del {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.42);
  color: #fff;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.14s, background 0.14s;
  backdrop-filter: blur(4px);
}
.pim-cell:hover .pim-del { opacity: 1; }
.pim-del:hover { background: rgba(220, 38, 38, 0.9); }

@media (max-width: 760px) {
  .pim-bar { opacity: 1; }
  .pim--lg .pim-grid { width: 100%; margin-inline: 0; }
  .pim--sm .pim-grid { max-width: 100%; }
  .pim-grid { gap: 6px; }
  /* 移动端多图统一 1:1：窄屏两列若各按原比例，一横一竖会撕出大片空洞。
     竖图组除外 —— 它靠高度约束，硬压成方形会把书页裁掉一大半。 */
  .pim:not(.pim--single) .pim-grid:not(.pim-grid--figures) .pim-cell { aspect-ratio: 1 / 1 !important; }
  /* 竖图组在窄屏放不下一行，改成横滑（像翻书页），比换行成 2+1 好读 */
  .pim-grid--figures {
    flex-wrap: nowrap;
    justify-content: flex-start;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x proximity;
    padding-bottom: 4px;
  }
  .pim-grid--figures .pim-cell { height: min(40vh, 380px); scroll-snap-align: start; }
  .pim--sm .pim-grid--figures .pim-cell { height: min(30vh, 280px); }
  .pim--lg .pim-grid--figures .pim-cell { height: min(48vh, 460px); }
  .pim--single .pim-cell img { max-height: 56vh; }
  .pim-del { width: 18px; height: 18px; font-size: 12px; opacity: 0.62; }
}
</style>
