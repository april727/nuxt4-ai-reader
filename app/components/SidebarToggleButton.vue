<script setup lang="ts">
/**
 * SidebarToggleButton.vue
 * 还原 Claude.ai 左侧栏顶部的"折叠/展开"图标按钮
 *
 * 用法：
 * <SidebarToggleButton v-model="collapsed" />
 */
interface Props {
  modelValue: boolean // true = 已折叠, false = 展开
  size?: number
}

const props = withDefaults(defineProps<Props>(), {
  size: 32,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

function toggle() {
  emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <button
    type="button"
    class="sidebar-toggle-btn"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :aria-pressed="modelValue"
    :aria-label="modelValue ? '展开侧栏' : '折叠侧栏'"
    @click="toggle"
  >
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class="sidebar-toggle-icon"
    >
      <!-- 外框 -->
      <rect
        x="2.5"
        y="3.5"
        width="15"
        height="13"
        rx="2.5"
        stroke="currentColor"
        stroke-width="1.4"
      />
      <!-- 竖线，分隔出左侧窄栏 -->
      <line
        x1="7.3"
        y1="3.5"
        x2="7.3"
        y2="16.5"
        stroke="currentColor"
        stroke-width="1.4"
      />
    </svg>
  </button>
</template>

<style scoped>
.sidebar-toggle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  color: rgb(107, 107, 100);
  padding: 0;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.sidebar-toggle-btn:hover {
  background-color: rgba(0, 0, 0, 0.06);
  color: rgb(60, 60, 56);
}

.sidebar-toggle-btn:active {
  background-color: rgba(0, 0, 0, 0.1);
}

.sidebar-toggle-icon {
  width: 60%;
  height: 60%;
  transition: transform 0.15s ease;
}

.sidebar-toggle-btn:hover .sidebar-toggle-icon {
  transform: scale(1.05);
}

/* 暗色模式适配 */
@media (prefers-color-scheme: dark) {
  .sidebar-toggle-btn {
    color: rgba(255, 255, 255, 0.6);
  }
  .sidebar-toggle-btn:hover {
    background-color: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.9);
  }
}
</style>
