<template>
  <Teleport to="body">
    <Transition name="ra-fade">
      <div v-if="visible" class="ra-backdrop" @mousedown.self="$emit('close')">
        <div class="reading-mode-panel" ref="rootRef" @click.stop>
          <!-- 字体 -->
          <section class="panel-section">
            <h3 class="section-title">字体</h3>
            <div class="font-dropdown" :class="{ open: fontMenuOpen }">
              <button type="button" class="font-trigger" @click="fontMenuOpen = !fontMenuOpen">
                <span class="font-icon" aria-hidden="true"><span class="font-icon-small">A</span><span class="font-icon-large">A</span></span>
                <span class="font-name" :style="{ fontFamily: currentFontStack }">{{ currentFontLabel }}</span>
                <svg class="chevron" :class="{ open: fontMenuOpen }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <ul v-if="fontMenuOpen" class="font-menu" role="listbox">
                <li v-for="f in fonts" :key="f.key" role="option" :class="{ selected: font === f.key }" class="font-option" :style="{ fontFamily: f.stack }" @click="selectFont(f.key)">{{ f.label }}</li>
              </ul>
            </div>
          </section>

          <!-- 字体大小 -->
          <section class="panel-section">
            <h3 class="section-title">字体大小</h3>
            <div class="slider-row">
              <input type="range" class="fluent-slider" :min="sizeRange[0]" :max="sizeRange[1]" step="1" v-model.number="fontSizeLevel" :style="trackStyle(fontSizeLevel, sizeRange)" />
            </div>
            <div class="slider-labels"><span>小</span><span>大</span></div>
          </section>

          <!-- 列宽 -->
          <section class="panel-section">
            <h3 class="section-title">列宽</h3>
            <div class="slider-row">
              <input type="range" class="fluent-slider" :min="widthRange[0]" :max="widthRange[1]" step="1" v-model.number="columnWidthLevel" :style="trackStyle(columnWidthLevel, widthRange)" />
            </div>
            <div class="slider-labels"><span>窄</span><span>宽</span></div>
          </section>

          <!-- 主题 -->
          <section class="panel-section no-border">
            <h3 class="section-title">主题</h3>
            <div class="theme-grid" role="radiogroup">
              <button v-for="c in themeColors" :key="c.value" type="button" class="theme-swatch" :style="{ backgroundColor: c.value }" role="radio" :aria-label="c.label || c.value" @click="theme = c.value">
                <svg v-if="theme === c.value" class="check-icon" :class="{ light: c.dark }" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5L6.2 11.7L13 4.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
          </section>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{ visible: boolean }>()
defineEmits<{ close: [] }>()

const STORAGE_KEY = 'reader-appearance'
const SIZE_MAP = [13, 14, 15, 16, 18, 20, 22]
const WIDTH_MAP = [480, 540, 600, 680, 760, 860, 960]

interface Settings { font: string; fontSizeLevel: number; columnWidthLevel: number; theme: string }
function load(): Settings {
  const dflt: Settings = { font: 'lora', fontSizeLevel: 5, columnWidthLevel: 5, theme: '#FFFFFF' }
  if (typeof localStorage === 'undefined') return dflt // SSR guard
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return dflt
    const d = JSON.parse(raw)
    // 迁移旧数据：theme 必须是十六进制颜色
    if (!d.theme || !/^#[0-9A-Fa-f]{6}$/.test(d.theme)) d.theme = dflt.theme
    // 迁移旧数据：fontSizeLevel/columnWidthLevel 必须是数字
    if (typeof d.fontSizeLevel !== 'number') d.fontSizeLevel = dflt.fontSizeLevel
    if (typeof d.columnWidthLevel !== 'number') d.columnWidthLevel = dflt.columnWidthLevel
    return { ...dflt, ...d }
  } catch { return dflt }
}
function save(partial: Partial<Settings>) {
  const s = { ...load(), ...partial }; localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); applyRoot(s)
}

function applyRoot(s: Settings) {
  if (typeof document === 'undefined') return // SSR guard
  const root = document.documentElement
  root.style.setProperty('--ra-font-size', SIZE_MAP[s.fontSizeLevel - 1] + 'px')
  root.style.setProperty('--ra-col-width', WIDTH_MAP[s.columnWidthLevel - 1] + 'px')
  root.style.setProperty('--ra-bg', s.theme)
  root.style.setProperty('--ra-fg', luminance(s.theme) > 0.5 ? '#1a1a18' : '#d4d4d4')
  const f = fonts.find(x => x.key === s.font)
  if (f) root.style.setProperty('--ra-font', f.stack)
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const fonts = [
  { key: 'lora', label: 'Lora', stack: '"Lora", Georgia, serif' },
  { key: 'sans', label: '无衬线', stack: '"DM Sans", system-ui, sans-serif' },
  { key: 'mono', label: '等宽', stack: '"DM Mono", monospace' },
  { key: 'georgia', label: 'Georgia', stack: 'Georgia, serif' },
]

const sizeRange: [number, number] = [1, 7]
const widthRange: [number, number] = [1, 7]

const currentSettings = reactive(load())
const font = ref(currentSettings.font)
const fontSizeLevel = ref(currentSettings.fontSizeLevel)
const columnWidthLevel = ref(currentSettings.columnWidthLevel)
const theme = ref(currentSettings.theme)

const currentFont = computed(() => fonts.find(f => f.key === font.value))
const currentFontStack = computed(() => currentFont.value?.stack || '')
const currentFontLabel = computed(() => currentFont.value?.label || '')

const fontMenuOpen = ref(false)
const rootRef = ref<HTMLElement | null>(null)

function selectFont(key: string) { font.value = key; fontMenuOpen.value = false; save({ font: key }) }
watch(fontSizeLevel, v => save({ fontSizeLevel: v }))
watch(columnWidthLevel, v => save({ columnWidthLevel: v }))
watch(theme, v => save({ theme: v }))

function trackStyle(value: number, range: [number, number]) {
  const [min, max] = range; const pct = ((value - min) / (max - min)) * 100
  return { background: `linear-gradient(to right, #3d3591 ${pct}%, #e3e3e3 ${pct}%)` }
}

function handleOutside(e: MouseEvent) {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) fontMenuOpen.value = false
}

// 同步应用初始设置（仅客户端）
const initSettings = load()
if (typeof document !== 'undefined') applyRoot(initSettings)

onMounted(() => { document.addEventListener('mousedown', handleOutside) })
onUnmounted(() => document.removeEventListener('mousedown', handleOutside))
</script>

<style scoped>
.reading-mode-panel {
  --rmp-accent: #3d3591; --rmp-track: #e3e3e3; --rmp-border: #e6e6e6; --rmp-text: #1f1f1f;
  width: 340px; background: #ffffff; border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15); padding: 20px 22px 24px;
  font-family: 'DM Sans', sans-serif; color: var(--rmp-text); box-sizing: border-box;
}
.panel-section { padding-bottom: 16px; margin-bottom: 16px; border-bottom: 1px solid var(--rmp-border); }
.panel-section.no-border { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
.section-title { font-size: 13px; font-weight: 600; margin: 0 0 10px; color: #6b6963; }

.font-dropdown { position: relative; }
.font-trigger {
  width: 100%; display: flex; align-items: center; gap: 8px;
  background: #fff; border: 1px solid #d4d4d4; border-radius: 6px;
  padding: 8px 10px; cursor: pointer; font-size: 14px; color: var(--rmp-text);
}
.font-dropdown.open .font-trigger { border-color: var(--rmp-accent); }
.font-icon { display: inline-flex; align-items: baseline; gap: 1px; color: #444; flex-shrink: 0; }
.font-icon-small { font-size: 10px; }
.font-icon-large { font-size: 15px; }
.font-name { flex: 1; text-align: left; }
.chevron { width: 14px; height: 14px; color: #555; flex-shrink: 0; transition: transform 0.15s; }
.chevron.open { transform: rotate(180deg); }
.font-menu {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0;
  background: #fff; border: 1px solid #e2e2e2; border-radius: 8px;
  box-shadow: 0 6px 18px rgba(0,0,0,0.12); list-style: none; margin: 0; padding: 6px;
  max-height: 180px; overflow-y: auto; z-index: 10;
}
.font-option { padding: 8px 10px; border-radius: 5px; font-size: 15px; cursor: pointer; }
.font-option:hover { background: #f2f2f2; }
.font-option.selected { background: #f0edfa; color: var(--rmp-accent); }

.slider-row { padding: 2px 0; }
.fluent-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 4px; border-radius: 2px; outline: none; cursor: pointer; }
.fluent-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 20px; height: 20px; border-radius: 50%; background: var(--rmp-accent); box-shadow: 0 1px 4px rgba(0,0,0,0.2); }
.slider-labels { display: flex; justify-content: space-between; font-size: 12px; color: #6b6b6b; margin-top: 4px; }

.theme-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
.theme-swatch {
  width: 100%; aspect-ratio: 1; border-radius: 50%; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.06); transition: transform 0.12s;
}
.theme-swatch:hover { transform: scale(1.1); }
.check-icon { width: 14px; height: 14px; color: #1f1f1f; }
.check-icon.light { color: #fff; }

.ra-backdrop { position: fixed; inset: 0; z-index: 2000; }
.ra-fade-enter-active, .ra-fade-leave-active { transition: opacity 0.15s; }
.ra-fade-enter-from, .ra-fade-leave-to { opacity: 0; }
</style>
