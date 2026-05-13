export function useTheme() {
  const dark = useLocalStorage('ai-reader-dark', false)
  if (import.meta.client) {
    watch(dark, (v) => document.documentElement.classList.toggle('dark', v), { immediate: true })
  }
  return { dark, toggle: () => { dark.value = !dark.value } }
}
