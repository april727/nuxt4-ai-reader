<template>
  <NuxtLayout>
    <NuxtPage :key="route.fullPath" />
  </NuxtLayout>
</template>

<script setup lang="ts">
const route = useRoute()
</script>
