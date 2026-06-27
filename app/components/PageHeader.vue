<template>
  <header class="ph">
    <div class="ph-left">
      <NuxtLink v-if="backTo" :to="backTo" class="ph-back">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="15 18 9 12 15 6"/></svg>
        {{ backLabel }}
      </NuxtLink>
      <h1 class="ph-title">{{ title }}</h1>
    </div>
    <div class="ph-right">
      <slot name="actions" />
      <PageNav :active="active" />
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
</script>

<style scoped>
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
}

.ph-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

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

.ph-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: 16px;
}
</style>
