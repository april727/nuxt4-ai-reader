/** 移动端检测（断点 768px） */
export function useIsMobile() {
  const isMobile = ref<boolean>(false)
  const check = () => { isMobile.value = typeof window !== 'undefined' && window.innerWidth < 768 }
  onMounted(() => { check(); window.addEventListener('resize', check) })
  onBeforeUnmount(() => { window.removeEventListener('resize', check) })
  return isMobile
}
