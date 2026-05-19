export interface BatchState {
  total: number
  current: number
  errors: string[]
  done: boolean
}

// 全局批处理进度状态（服务进程内存中）
export const batchProgress = new Map<string, BatchState>()
