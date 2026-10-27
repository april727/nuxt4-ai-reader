<template>
  <header class="ph">
    <div class="ph-left">
      <NuxtLink v-if="backTo" :to="backTo" class="ph-back">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="15 18 9 12 15 6"/></svg>
        <span class="ph-back-label">{{ backLabel }}</span>
      </NuxtLink>
      <h1 class="ph-title">{{ title }}</h1>
    </div>

    <div class="ph-right">
      <!-- 页面操作按钮（各页面通过 #actions 插槽传入） -->
      <div class="ph-actions" v-if="$slots.actions">
        <slot name="actions" />
      </div>

      <!-- ====== 宽屏：内联导航 ====== -->
      <PageNav :active="active" class="ph-inline-nav" />

      <!-- ====== 窄屏：下拉菜单按钮 ====== -->
      <div class="ph-menu-wrap" ref="menuRef">
        <button
          class="ph-menu-btn"
          @click.stop="menuOpen = !menuOpen"
          :aria-label="menuOpen ? '关闭菜单' : '打开菜单'"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <template v-if="!menuOpen">
              <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
            </template>
            <template v-else>
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </template>
          </svg>
        </button>
        <Transition name="ph-menu-fade">
          <div v-if="menuOpen" class="ph-menu-drop">
            <NuxtLink to="/words/daily" class="ph-menu-link" :class="{ active: active === 'daily' }" @click="menuOpen = false">每日</NuxtLink>
            <NuxtLink to="/reviews" class="ph-menu-link" :class="{ active: active === 'reviews' }" @click="menuOpen = false">复习本</NuxtLink>
            <NuxtLink to="/words/analysis" class="ph-menu-link" :class="{ active: active === 'analysis' }" @click="menuOpen = false">分析</NuxtLink>
            <NuxtLink to="/wordbooks" class="ph-menu-link" :class="{ active: active === 'wordbooks' }" @click="menuOpen = false">单词本</NuxtLink>
          </div>
        </Transition>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  active: string
  backTo?: string
  backLabel?: string
}>()

const menuOpen = ref(false)
const menuRef = ref<HTMLDivElement>()

// 点击外部关闭下拉菜单
function onDocClick(e: MouseEvent) {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) {
    menuOpen.value = false
  }
}
watch(menuOpen, (v) => {
  if (v) {
    document.addEventListener('click', onDocClick)
  } else {
    document.removeEventListener('click', onDocClick)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
})
</script>

<style scoped>
/* ================================================================
   整体布局
   ================================================================ */
.ph {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 50px;
  padding: 0 16px;
  flex-shrink: 0;
  border-bottom: 0.5px solid rgba(0,0,0,0.07);
  background: transparent;
  box-sizing: border-box;
  gap: 6px;
}

.ph-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-shrink: 1;
}

.ph-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* ---- 返回按钮 ---- */
.ph-back {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8rem;
  color: #6b6963;
  text-decoration: none;
  padding: 4px 6px;
  border-radius: 5px;
  flex-shrink: 0;
  transition: background 0.12s;
}
.ph-back:hover { background: rgba(0,0,0,0.04); }
.ph-back-label { white-space: nowrap; }

.ph-title {
  font-family: 'Lora', Georgia, serif;
  font-size: 1.1rem;
  font-weight: 600;
  color: #1a1a18;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---- 操作按钮区域 ---- */
.ph-actions {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

/* ================================================================
   内联导航（宽屏显示，窄屏隐藏）
   ================================================================ */
.ph-inline-nav {
  display: flex;
}

/* ================================================================
   下拉菜单按钮与面板（宽屏隐藏，窄屏显示）
   ================================================================ */
.ph-menu-wrap {
  display: none;
  position: relative;
}

.ph-menu-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 0.5px solid rgba(0,0,0,0.1);
  border-radius: 8px;
  background: #fff;
  color: #6b6963;
  cursor: pointer;
  transition: all 0.12s;
  flex-shrink: 0;
}
.ph-menu-btn:hover {
  border-color: #3d3591;
  color: #3d3591;
}

.ph-menu-drop {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 200;
  margin-top: 6px;
  min-width: 130px;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.08);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ph-menu-link {
  display: block;
  padding: 9px 14px;
  border-radius: 7px;
  font-size: 0.84rem;
  color: #6b6963;
  text-decoration: none;
  font-family: 'DM Sans', sans-serif;
  transition: all 0.1s;
  white-space: nowrap;
}
.ph-menu-link:hover {
  background: #f0efe9;
  color: #3d3591;
}
.ph-menu-link.active {
  background: #edeafd;
  color: #3d3591;
  font-weight: 500;
}

/* 下拉菜单过渡动画 */
.ph-menu-fade-enter-active,
.ph-menu-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.ph-menu-fade-enter-from,
.ph-menu-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* ================================================================
   响应式断点：宽度不足 680px 时切换到下拉菜单模式
   ================================================================ */
@media (max-width: 680px) {
  /* 窄屏：隐藏返回按钮文字（只保留图标） */
  .ph-back-label { display: none; }

  /* 窄屏：隐藏内联 PageNav */
  .ph-inline-nav { display: none; }

  /* 窄屏：显示下拉菜单按钮 */
  .ph-menu-wrap { display: block; }
}
</style>
