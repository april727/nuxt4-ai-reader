// localStorage 封装，支持类型安全读写
export function useLocalStorage<T>(key: string, defaultValue: T) {
  const stored = ref<T>(defaultValue) as Ref<T>

  // 仅在客户端读取 localStorage
  if (import.meta.client) {
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) {
        stored.value = JSON.parse(raw) as T
      }
    } catch {
      // 解析失败则使用默认值
    }
  }

  watch(
    stored,
    (val) => {
      if (import.meta.client) {
        try {
          localStorage.setItem(key, JSON.stringify(val))
        } catch {
          // 存储失败则忽略
        }
      }
    },
    { deep: true }
  )

  return stored
}
