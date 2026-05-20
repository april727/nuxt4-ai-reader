<template>
  <div class="ta-group">
    <div class="ta-dropdown" ref="dropdownRef">
      <button class="ta-btn" @click.stop="showMenu = !showMenu">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 5v14M5 12h14"/></svg>
        <span>添加</span>
        <svg class="ta-chevron" :class="{ open: showMenu }" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <Transition name="drop-enter">
        <div v-if="showMenu" class="ta-menu" @click.stop>
          <button @click="emit('importVideo'); showMenu = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
            导入视频
          </button>
          <button @click="emit('upload'); showMenu = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-1.5-.5"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            上传文件
          </button>
          <button @click="emit('url'); showMenu = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            提取网页
          </button>
        </div>
      </Transition>
    </div>
    <button class="ta-btn ta-accent" @click="navigateTo('/reviews')" title="复习本">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
      <span>复习本</span>
    </button>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  importVideo: []
  upload: []
  url: []
}>()

const showMenu = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

function onDocClick(e: MouseEvent) {
  if (showMenu.value && dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    showMenu.value = false
  }
}
</script>

<style scoped>
.ta-group {
  display: flex;
  gap: 6px;
}

.ta-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 14px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  background: #ffffff;
  color: #6b6963;
  font-size: 13px;
  font-weight: 450;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
  white-space: nowrap;
}
.ta-btn:hover {
  color: #1a1a18;
  border-color: rgba(0, 0, 0, 0.14);
  background: #fafaf8;
}

.ta-accent {
  color: #3d3591;
  border-color: rgba(61, 53, 145, 0.15);
  background: #f9f7ff;
}
.ta-accent:hover {
  background: #3d3591;
  color: #ffffff;
  border-color: #3d3591;
}

/* dropdown */
.ta-dropdown { position: relative; }
.ta-chevron {
  flex-shrink: 0;
  transition: transform 0.2s;
}
.ta-chevron.open { transform: rotate(180deg); }

.ta-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 140px;
  background: #ffffff;
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.08);
  padding: 6px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ta-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 12px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #4a4a46;
  font-size: 13px;
  font-family: 'DM Sans', sans-serif;
  cursor: pointer;
  transition: background 0.12s;
  text-align: left;
}
.ta-menu button:hover {
  background: rgba(0,0,0,0.04);
  color: #1a1a18;
}

.drop-enter-enter-active, .drop-enter-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}
.drop-enter-enter-from, .drop-enter-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
