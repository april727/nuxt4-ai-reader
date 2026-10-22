/**
 * useStickyNotes - 便签状态管理 Composable
 * 负责便签数据的增删改查、拖拽状态、localStorage 持久化
 * 与 UI 组件完全解耦
 */

export interface StickyNote {
  id: number
  text: string
  color: string
  left: string
  top: string
  shape: 'rectangle' | 'circle' | 'cloud' | 'blob'
  rotation: number
  zIndex: number
  quote: string
}

export type NoteShape = StickyNote['shape']

const STORAGE_KEY = 'sticky-notes'

const QUOTES = [
  'Believe in yourself!',
  'Stay focused and never give up.',
  'One step at a time.',
  'You can do it!',
  'Push your limits.',
  'Progress over perfection.',
  'Consistency is key.',
  'Dream big, start small.',
  'Make it happen!',
  'Keep going!',
]

const SHAPE_COLORS: Record<NoteShape, string> = {
  rectangle: '#fffb8f',
  circle: '#ffd166',
  cloud: '#f8f8f8',
  blob: '#b5ead7',
}

function getRandomQuote(): string {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)]
}

function getRandomPosition(): { left: string; top: string } {
  return {
    left: `${Math.random() * 100 + 20}px`,
    top: `${Math.random() * 100 + 20}px`,
  }
}

function getRandomRotation(): number {
  return Math.floor(Math.random() * 6) - 3
}

export function useStickyNotes() {
  const notes = ref<StickyNote[]>([])
  const isLoaded = ref(false)

  // ---- 持久化 ----
  function saveNotes() {
    if (import.meta.client) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes.value))
    }
  }

  function loadNotes() {
    if (import.meta.client) {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        try {
          notes.value = JSON.parse(raw)
        } catch {
          notes.value = []
        }
      }
      isLoaded.value = true
    }
  }

  // ---- CRUD ----
  function addNote(shape: NoteShape = 'rectangle') {
    const pos = getRandomPosition()
    const newNote: StickyNote = {
      id: Date.now(),
      text: '',
      color: SHAPE_COLORS[shape],
      left: pos.left,
      top: pos.top,
      shape,
      rotation: getRandomRotation(),
      zIndex: notes.value.length,
      quote: getRandomQuote(),
    }
    notes.value.push(newNote)
    saveNotes()
    return newNote
  }

  function deleteNote(id: number) {
    notes.value = notes.value.filter((n) => n.id !== id)
    saveNotes()
  }

  function clearAll() {
    notes.value = []
    saveNotes()
  }

  function updateNote(id: number, patch: Partial<StickyNote>) {
    const idx = notes.value.findIndex((n) => n.id === id)
    if (idx !== -1) {
      notes.value[idx] = { ...notes.value[idx], ...patch }
      saveNotes()
    }
  }

  function bringToFront(id: number) {
    const maxZ = notes.value.reduce((max, n) => Math.max(max, n.zIndex), 0)
    updateNote(id, { zIndex: maxZ + 1 })
  }

  // ---- 拖拽 ----
  const draggingId = ref<number | null>(null)
  let dragOffset = { x: 0, y: 0 }

  function startDrag(id: number, clientX: number, clientY: number, el: HTMLElement) {
    draggingId.value = id
    const rect = el.getBoundingClientRect()
    dragOffset = {
      x: clientX - rect.left,
      y: clientY - rect.top,
    }
    bringToFront(id)
  }

  function onDragMove(clientX: number, clientY: number, containerRect: DOMRect) {
    if (draggingId.value === null) return
    const idx = notes.value.findIndex((n) => n.id === draggingId.value)
    if (idx === -1) return

    const newLeft = clientX - containerRect.left - dragOffset.x
    const newTop = clientY - containerRect.top - dragOffset.y
    notes.value[idx] = {
      ...notes.value[idx],
      left: `${Math.max(0, newLeft)}px`,
      top: `${Math.max(0, newTop)}px`,
    }
  }

  function endDrag() {
    if (draggingId.value !== null) {
      saveNotes()
    }
    draggingId.value = null
  }

  // ---- 初始化 ----
  onMounted(() => {
    loadNotes()
    // 首次使用时创建两张示例便签
    if (notes.value.length === 0) {
      setTimeout(() => {
        addNote('rectangle')
        addNote('circle')
      }, 300)
    }
  })

  return {
    notes,
    isLoaded,
    draggingId,
    addNote,
    deleteNote,
    clearAll,
    updateNote,
    bringToFront,
    startDrag,
    onDragMove,
    endDrag,
    SHAPE_COLORS,
  }
}