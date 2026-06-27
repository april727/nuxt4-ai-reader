<template>
  <div class="pn-links">
    <NuxtLink to="/words/daily" class="pn-link" :class="{ active: active === 'daily' }">每日</NuxtLink>
    <NuxtLink to="/reviews" class="pn-link" :class="{ active: active === 'reviews' }">复习本</NuxtLink>
    <NuxtLink to="/words/analysis" class="pn-link" :class="{ active: active === 'analysis' }">分析</NuxtLink>
    <NuxtLink to="/wordbooks" class="pn-link" :class="{ active: active === 'wordbooks' }">单词本</NuxtLink>
  </div>
</template>

<script setup lang="ts">
defineProps<{ active?: string }>()
</script>

<style scoped>
.pn-links { display: flex; gap: 4px; flex-shrink: 0; }
.pn-link {
  display: inline-flex; align-items: center;
  font-size: 0.75rem; font-weight: 450; color: #6b6963;
  text-decoration: none; padding: 5px 10px; border-radius: 7px;
  border: 0.5px solid rgba(0,0,0,0.1);
  transition: all 0.12s; white-space: nowrap;
}
.pn-link:hover { background: #f0efe9; color: #3d3591; }
.pn-link.active { background: #edeafd; color: #3d3591; border-color: rgba(61,53,145,0.15); }
</style>
