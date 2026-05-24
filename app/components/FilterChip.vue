<template>
  <div class="fc-group">
    <button
      v-for="opt in options"
      :key="opt.key"
      class="fc-chip"
      :class="{ active: modelValue === opt.key }"
      @click="$emit('update:modelValue', opt.key)"
    >{{ opt.label }}</button>
    <template v-if="sortModel !== undefined">
      <span class="fc-sep"></span>
      <button class="fc-chip fc-sort" @click="$emit('cycleSort')" :title="sortLabel">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path v-if="sortModel === 'newest'" d="M3 4h13M3 8h9M3 12h5M17 8v10M17 18l-3-3M17 18l3-3"/>
          <path v-else-if="sortModel === 'title'" d="M3 7h18M3 14h14M3 21h10"/>
          <path v-else d="M16 21v-14M11 4l-5 5M11 4l5 5"/>
        </svg>
        {{ sortLabel }}
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  options: Array<{ key: string; label: string }>
  modelValue: string
  sortModel?: string
  sortLabel?: string
}>(), {
  sortModel: undefined,
  sortLabel: undefined,
})

defineEmits<{
  'update:modelValue': [key: string]
  cycleSort: []
}>()
</script>

<style scoped>
.fc-group {
  display: flex;
  align-items: center;
  gap: 0;
  background: rgba(0,0,0,0.05);
  border-radius: 9px;
  padding: 3px;
}

.fc-chip {
  padding: 6px 14px;
  border-radius: 7px;
  border: none;
  background: transparent;
  font-size: 13px;
  font-weight: 450;
  color: #8a877c;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
}
.fc-chip.active {
  background: #ffffff;
  font-weight: 500;
  color: #3d3591;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.fc-sep {
  width: 1px;
  height: 18px;
  background: rgba(92, 92, 92, 0.08);
  margin: 0 6px;
}

.fc-sort {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
