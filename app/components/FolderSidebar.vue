<template>
  <div class="folder-sidebar">
    <!-- 头部 -->
    <div class="fs-header">
      <img v-show="!collapsed" :src="'/icon+title.png'" alt="yu reader" class="fs-logo-icon" @click="handleTitleClick" />
      <SidebarToggleButton :model-value="collapsed" :size="28" @update:model-value="emit('toggle')" />
    </div>

    <!-- 文件夹列表 -->
    <template v-if="!collapsed">
    <div class="fs-section-label">
      <span>文件夹</span>
      <button class="fs-add-btn" @click="startCreate" title="新建文件夹">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
      </button>
    </div>
    <div class="fs-list">
      <template v-for="f in visibleFolders" :key="f.id">
        <!-- Card -->
        <div
          class="fs-card"
          :class="{
            active: activeFolder === f.id,
            'drag-over': dragTarget === f.id,
            'is-private': f.isPrivate,
          }"
          role="button"
          tabindex="0"
          @click="handleFolderClick(f)"
          @contextmenu.prevent="handleContextMenu(f, $event)"
          @dragover.prevent
          @dragenter.prevent="onDragEnter(f.id)"
          @dragleave="onDragLeave($event, f.id)"
          @drop.prevent="$emit('dropOnFolder', f.id); dragTarget = ''"
        >
          <div class="fsc-active-bar"></div>
          <div class="fsc-body">
            <div class="fsc-top">
              <div class="fsc-icon-wrap">
                <svg class="fsc-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <span class="fsc-name">{{ f.name }}</span>
              <span v-if="f.isPrivate && showPrivate" class="fsc-lock-dot">&#x1f512;</span>
              <span class="fsc-count-right">{{ counts[f.id] || 0 }}</span>
            </div>
            <div class="fsc-meta" v-if="subFolderCounts[f.id]">
              <span>{{ subFolderCounts[f.id] }} 个子文件夹</span>
            </div>
          </div>
        </div>

        <!-- 子文件夹（缩进嵌套） -->
        <div
          v-for="sub in getSubFolders(f.id)"
          :key="sub.id"
          class="fs-card fs-sub-card"
          :class="{ active: activeFolder === sub.id, 'is-private': sub.isPrivate }"
          role="button"
          tabindex="0"
          @click="handleFolderClick(sub)"
          @contextmenu.prevent="handleContextMenu(sub)"
          @dragover.prevent
          @dragenter.prevent="onDragEnter(sub.id)"
          @dragleave="onDragLeave($event, sub.id)"
          @drop.prevent="$emit('dropOnFolder', sub.id); dragTarget = ''"
        >
          <div class="fsc-active-bar"></div>
          <div class="fsc-body">
            <div class="fsc-top">
              <div class="fsc-icon-wrap">
                <svg class="fsc-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <span class="fsc-name">{{ sub.name }}</span>
              <span v-if="sub.isPrivate && showPrivate" class="fsc-lock-dot">&#x1f512;</span>
              <span class="fsc-count-right">{{ counts[sub.id] || 0 }}</span>
            </div>
          </div>
        </div>
      </template>

      <!-- 展开更多 / 私密提示 -->
      <button
        v-if="hiddenFolderCount > 0 && !showAllFolders"
        class="fs-expand-btn"
        @click="showAllFolders = true"
      >展开全部 ({{ hiddenFolderCount }})</button>
      <button
        v-if="showAllFolders && hiddenFolderCount > 0"
        class="fs-expand-btn"
        @click="showAllFolders = false"
      >收起</button>

      <!-- 新建文件夹输入 -->
      <div v-if="creating" class="fs-card fs-new-input">
        <input ref="newFolderInput" v-model="newFolderName" class="fs-input" :placeholder="creatingSub ? '子文件夹名称' : '文件夹名称'" @keydown.enter="createFolder" @keydown.escape="creating=false; newFolderName=''; creatingSub=''" @blur="creating=false; newFolderName=''; creatingSub=''" />
      </div>

    </div>

    <!-- 快捷导航 -->
    <div class="fs-nav-divider"></div>
    <div class="fs-nav-list">
      <button class="fs-nav-btn" @click="navigateTo('/words/daily')">每日单词</button>
      <button class="fs-nav-btn" @click="navigateTo('/words/analysis')">学习分析</button>
      <button class="fs-nav-btn" @click="navigateTo('/reviews')">复习本</button>
      <button class="fs-nav-btn" @click="navigateTo('/wordbooks')">单词本</button>
      <button class="fs-nav-btn" @click="navigateTo('/knowledge')">知识要点</button>
    </div>
    </template>

    <!-- 折叠态图标导航 -->
    <div v-if="collapsed" class="fs-collapsed-nav">
      <button class="fs-collapsed-btn" title="每日单词" @click="navigateTo('/words/daily')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </button>
      <button class="fs-collapsed-btn" title="学习分析" @click="navigateTo('/words/analysis')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      </button>
      <button class="fs-collapsed-btn" title="复习本" @click="navigateTo('/reviews')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      </button>
      <button class="fs-collapsed-btn" title="单词本" @click="navigateTo('/wordbooks')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      </button>
      <button class="fs-collapsed-btn" title="知识要点" @click="navigateTo('/knowledge')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      </button>
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <Transition name="ctx-fade">
        <div v-if="ctxMenu.show" class="ctx-backdrop" @click="ctxMenu.show = false" @contextmenu.prevent="ctxMenu.show = false">
          <div class="ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" @click.stop>
            <button @click="renameFolder">重命名</button>
            <button @click="addSubFolder">新建子文件夹</button>
            <button v-if="showPrivate && ctxMenu.folderId !== 'default'" @click="ctxTogglePrivacy">{{ ctxMenu.isPrivate ? '取消私密' : '设为私密' }}</button>
            <hr class="ctx-divider" />
            <button v-if="ctxMenu.folderId !== 'default'" class="ctx-danger" @click="deleteFolder">删除文件夹</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 密码弹窗 -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="passwordModal.show" class="pw-overlay" @click.self="closePwModal">
          <div class="pw-card">
            <h3 class="pw-title">{{ passwordModal.mode === 'set' ? '设置访问密码' : '需要密码' }}</h3>
            <p class="pw-hint" v-if="passwordModal.mode === 'set'">为「{{ passwordModal.folderName }}」设置密码（至少4位）</p>
            <p class="pw-hint" v-else>「{{ passwordModal.folderName }}」已加密</p>
            <input
              ref="pwInputRef"
              v-model="passwordInput"
              type="password"
              class="pw-input"
              autocomplete="new-password"
              :placeholder="passwordModal.mode === 'set' ? '设置密码' : '输入密码'"
              @keydown.enter="submitPassword"
              autofocus
            />
            <p v-if="passwordError" class="pw-error">{{ passwordError }}</p>
            <div class="pw-actions">
              <button class="pw-btn-ghost" @click="closePwModal">取消</button>
              <button class="pw-btn-primary" :disabled="!passwordInput || passwordLoading" @click="submitPassword">
                {{ passwordModal.mode === 'set' ? '加密' : '解锁' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
interface Folder { id: string; name: string; parent?: string; isPrivate?: boolean }

const props = defineProps<{ folders: Folder[]; activeFolder: string; counts: Record<string, number>; collapsed?: boolean }>()
const emit = defineEmits<{
  select: [id: string]
  create: [name: string, parent?: string]
  dropOnFolder: [id: string]
  deleteFolder: [id: string]
  addSub: [parentId: string]
  renameFolder: [id: string, name: string]
  refresh: []
  toggle: []
}>()

// ── 右键菜单 ──
const ctxMenu = reactive({ show: false, x: 0, y: 0, folderId: '', folderName: '', isPrivate: false })

function showContextMenu(f: any, e: MouseEvent) {
  ctxMenu.show = true
  ctxMenu.x = Math.min(e.clientX, window.innerWidth - 150)
  ctxMenu.y = Math.min(e.clientY, window.innerHeight - 150)
  ctxMenu.folderId = f.id
  ctxMenu.folderName = f.name
  ctxMenu.isPrivate = !!f.isPrivate
}

function ctxTogglePrivacy() {
  const f = { id: ctxMenu.folderId, name: ctxMenu.folderName, isPrivate: ctxMenu.isPrivate }
  ctxMenu.show = false
  togglePrivacy(f)
}

function renameFolder() {
  const id = ctxMenu.folderId
  const name = prompt('新名称', ctxMenu.folderName)
  if (name && name.trim() && name.trim() !== ctxMenu.folderName) {
    emit('renameFolder', id, name.trim())
  }
  ctxMenu.show = false
}

function addSubFolder() {
  emit('addSub', ctxMenu.folderId)
  ctxMenu.show = false
}

function deleteFolder() {
  emit('deleteFolder', ctxMenu.folderId)
  ctxMenu.show = false
}

// ── 私密控制 ──
const showPrivate = ref(false)
const passwordModal = reactive({ show: false, mode: 'unlock' as 'set' | 'unlock', folderId: '', folderName: '' })
const passwordInput = ref('')
const passwordError = ref('')
const passwordLoading = ref(false)
const pwInputRef = ref<HTMLInputElement | null>(null)

const hasPrivate = computed(() => props.folders.some((f: any) => f.isPrivate))

// 子文件夹映射
const subFolderCounts = computed(() => {
  const map: Record<string, number> = {}
  for (const f of props.folders) {
    const pid = (f as any).parent || ''
    if (pid) map[pid] = (map[pid] || 0) + 1
  }
  return map
})

function getSubFolders(parentId: string) {
  return props.folders.filter((f: any) => (f.parent || '') === parentId)
}

// 可见文件夹：根级 + 过滤私密
const rootFolders = computed(() => props.folders.filter((f: any) => !f.parent))

const showAllFolders = ref(false)
const FOLDER_LIMIT = 6

const visibleFolders = computed(() => {
  let list = showPrivate.value ? rootFolders.value : rootFolders.value.filter((f: any) => !f.isPrivate)
  if (!showAllFolders.value && list.length > FOLDER_LIMIT) return list.slice(0, FOLDER_LIMIT)
  return list
})

const hiddenFolderCount = computed(() => {
  const total = showPrivate.value ? rootFolders.value.length : rootFolders.value.filter((f: any) => !f.isPrivate).length
  return Math.max(0, total - FOLDER_LIMIT)
})

// ── 三击标题 ──
let clickCount = 0
let clickTimer: ReturnType<typeof setTimeout> | null = null

function handleTitleClick() {
  clickCount++
  if (clickCount === 1) {
    clickTimer = setTimeout(() => { clickCount = 0 }, 600)
  } else if (clickCount === 3) {
    if (clickTimer) clearTimeout(clickTimer)
    clickCount = 0
    showPrivate.value = !showPrivate.value
  }
}

// ── 文件夹点击 ──
function handleFolderClick(f: any) {
  if (f.isPrivate) {
    // 私密文件夹每次都需密码
    passwordModal.mode = 'unlock'
    passwordModal.folderId = f.id
    passwordModal.folderName = f.name
    passwordModal.show = true
    passwordInput.value = ''
    passwordError.value = ''
    nextTick(() => pwInputRef.value?.focus())
  } else {
    emit('select', f.id)
  }
}

// ── 右键 → 显示菜单 ──
function handleContextMenu(f: any, e: MouseEvent) {
  showContextMenu(f, e)
}

async function togglePrivacy(f: any) {
  if (f.isPrivate) {
    try {
      await $fetch('/api/folder/toggle-privacy', { method: 'POST', body: { id: f.id } })
emit('refresh')
    } catch (e: any) {
      alert(e?.message || '操作失败')
    }
  } else {
    passwordModal.mode = 'set'
    passwordModal.folderId = f.id
    passwordModal.folderName = f.name
    passwordModal.show = true
    passwordInput.value = ''
    passwordError.value = ''
    nextTick(() => pwInputRef.value?.focus())
  }
}

async function submitPassword() {
  const pw = passwordInput.value
  if (!pw) return

  if (passwordModal.mode === 'set') {
    if (pw.length < 4) { passwordError.value = '密码至少需要4位'; return }
    passwordLoading.value = true
    try {
      await $fetch('/api/folder/toggle-privacy', { method: 'POST', body: { id: passwordModal.folderId, password: pw } })
      passwordModal.show = false
      emit('refresh')
    } catch (e: any) { passwordError.value = e?.message || '操作失败' }
    finally { passwordLoading.value = false }
  } else {
    passwordLoading.value = true
    try {
      await $fetch('/api/folder/unlock', { method: 'POST', body: { id: passwordModal.folderId, password: pw } })
passwordModal.show = false
      emit('select', passwordModal.folderId)
    } catch (e: any) { passwordError.value = e?.message || '密码错误' }
    finally { passwordLoading.value = false }
  }
}

function closePwModal() {
  passwordModal.show = false
  passwordInput.value = ''
  passwordError.value = ''
}

// ── 新建文件夹 ──
const creating = ref(false)
const newFolderName = ref('')
const newFolderInput = ref<HTMLInputElement | null>(null)
const dragTarget = ref('')
const creatingSub = ref('')

function startCreate() { creating.value = true; nextTick(() => newFolderInput.value?.focus()) }

function onDragEnter(fid: string) { dragTarget.value = fid }
function onDragLeave(e: DragEvent, fid: string) {
  const el = e.currentTarget as HTMLElement
  const related = e.relatedTarget as HTMLElement | null
  if (related && el.contains(related)) return
  dragTarget.value = ''
}

async function createFolder() {
  const name = newFolderName.value.trim()
  if (!name) { creating.value = false; creatingSub.value = ''; return }
  emit('create', name, creatingSub.value || undefined)
  newFolderName.value = ''; creating.value = false; creatingSub.value = ''
}

defineExpose({ startSubCreate(parentId: string) { creatingSub.value = parentId; startCreate() } })
</script>

<style scoped>
/* ── Layout ── */
.folder-sidebar {
  display: flex; flex-direction: column; height: 100%;
  background: transparent; font-family: 'DM Sans', sans-serif;
  overflow-y: auto;
}

.fs-header {
  display: flex; align-items: center;
  padding: 24px 8px 0 8px;
}
.fs-logo-icon { flex-shrink: 0; height: 26px; width: auto; border-radius: 6px; cursor: default; }
.fs-header :deep(.sidebar-toggle-btn) { margin-left: auto; flex-shrink: 0; }
.fs-title {
  font-family: 'Lora', Georgia, serif; font-size: 22px; font-weight: 500;
  color: #1a1a18; cursor: default; user-select: none; margin: 0;
}
.fs-private-indicator {
  font-size: 10px; color: #c4c0b8; margin-left: 2px; font-weight: 600;
}

/* ── Section label ── */
.fs-section-label {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 10px; font-weight: 500; color: #b0aca0;
  letter-spacing: 0.07em; text-transform: uppercase;
  padding: 14px 10px 4px 22px;
}
.fs-add-btn {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border: none; border-radius: 5px;
  background: transparent; color: #b0aca0; cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.fs-add-btn:hover { background: rgba(0,0,0,0.06); color: #5a5850; }

.fs-nav-divider {
  height: 1px; background: rgba(0,0,0,0.1); margin: 0 14px 4px;
}
.fs-nav-list {
  display: flex; flex-direction: column; gap: 1px;
  padding: 0 8px;
}
.fs-nav-btn {
  display: flex; align-items: center;
  width: 100%; padding: 7px 14px;
  border: none; border-radius: 8px; background: transparent;
  color: #7a7760; font-size: 13px; cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.fs-nav-btn:hover { background: rgba(0,0,0,0.04); color: #3d3591; }

.fs-collapsed-nav {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 62px 0 0;
}
.fs-collapsed-btn {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border: none; border-radius: 8px;
  background: transparent; color: #8a8678; cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.fs-collapsed-btn:hover { background: rgba(0,0,0,0.06); color: #3d3591; }

/* ── List / Cards ── */
.fs-list {
  padding: 0 10px 0;
  display: flex; flex-direction: column; gap: 2px;
}

/* ── Card ── */
.fs-card {
  display: flex; align-items: stretch; gap: 0;
  border-radius: 10px; border: 0.5px solid transparent;
  background: transparent; cursor: pointer;
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
  position: relative; overflow: hidden;
  min-height: 38px;
}

.fs-card:hover {
  background: rgba(0,0,0,0.025);
  border-color: rgba(0,0,0,0.06);
}
.fs-card.active {
  background: #ffffff;
  border-color: rgba(0,0,0,0.08);
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}

/* 左侧激活色条（已移除） */
.fsc-active-bar { display: none; }

/* ── Card body ── */
.fsc-body {
  flex: 1; min-width: 0;
  padding: 5px 0 5px 10px;
  display: flex; flex-direction: column; justify-content: center; gap: 2px;
}

.fsc-top {
  display: flex; align-items: center; gap: 8px;
}
.fsc-icon-wrap {
  flex-shrink: 0; width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
}
.fsc-icon { color: #8a8678; flex-shrink: 0; }
.fs-card.active .fsc-icon { color: #3d3591; }

.fsc-name {
  font-size: 13px; font-weight: 480; color: #4a4640;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  flex: 1; min-width: 0;
}
.fs-card.active .fsc-name { color: #1a1a18; font-weight: 550; }

/* 右侧计数 */
.fsc-count-right {
  flex-shrink: 0;
  font-size: 10.5px; font-weight: 500; color: #b0aca0;
  font-family: 'DM Mono', monospace;
  min-width: 22px; text-align: right;
  padding-right: 8px;
}
.fs-card.active .fsc-count-right { color: #8a8678; }

/* 私密角标 */
.fsc-lock-dot {
  font-size: 7px; flex-shrink: 0;
  opacity: 0.3; line-height: 1;
}

/* ── Meta row ── */
.fsc-meta {
  display: flex; align-items: center; gap: 4px;
  padding-left: 30px;
  font-size: 10.5px; color: #b0aca0;
}

/* ── 子文件夹缩进 ── */
.fs-sub-card { margin-left: 16px; min-height: 32px; }
.fs-sub-card .fsc-icon { width: 16px; height: 16px; }
.fs-sub-card .fsc-name { font-size: 12.5px; }
.fs-sub-card .fsc-count-right { font-size: 10px; }
.fs-sub-card .fsc-meta { font-size: 10px; padding-left: 26px; }

/* ── 私密 Card ── */
.fs-card.is-private { background: rgba(0,0,0,0.012); }

/* ── Drag over ── */
.fs-card.drag-over {
  border-color: rgba(61, 53, 145, 0.3) !important;
  background: rgba(61, 53, 145, 0.06) !important;
  box-shadow: 0 0 0 2px rgba(61, 53, 145, 0.08);
  transform: scale(1.02);
  transition: all 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* ── 展开更多按钮 ── */
.fs-expand-btn {
  display: block; width: 100%; padding: 4px 0 4px; margin: 0 0 8px;
  border: none; background: transparent; color: #8a8880;
  font-size: 12px; cursor: pointer; border-radius: 6px;
  transition: background 0.15s, color 0.15s;
}
.fs-expand-btn:hover { background: rgba(0,0,0,0.04); color: #5a5850; }

/* ── 新建文件夹 ── */
.fs-new-input { padding: 2px; min-height: auto; }
.fs-input {
  width: 100%; padding: 8px 10px; border: 1px solid #3d3591; border-radius: 8px;
  font-size: 12.5px; outline: none; background: #ffffff; color: #1a1a18;
  font-family: 'DM Sans', sans-serif;
}
.fs-input::placeholder { color: #c0bdb4; }

/* ── Password modal ── */
.pw-overlay {
  position: fixed; inset: 0; z-index: 400;
  background: rgba(45, 42, 38, 0.25); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
}
.pw-card {
  background: #ffffff; border-radius: 14px; border: 1px solid rgba(0,0,0,0.05);
  box-shadow: 0 16px 48px rgba(0,0,0,0.1); width: 320px; max-width: 92vw; padding: 24px;
}
.pw-title {
  font-family: 'Lora', Georgia, serif; font-size: 1em; font-weight: 500;
  color: #1a1a18; margin: 0 0 6px;
}
.pw-hint { font-size: 12px; color: #a09e97; margin: 0 0 14px; }
.pw-input {
  width: 100%; padding: 10px 14px; border: 1px solid rgba(0,0,0,0.1); border-radius: 10px;
  font-size: 14px; color: #1a1a18; background: #fafaf8; outline: none; font-family: inherit;
}
.pw-input:focus { border-color: #3d3591; background: #fff; }
.pw-error { font-size: 12px; color: #b84b2e; margin: 6px 0 0; }
.pw-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.pw-btn-ghost {
  padding: 8px 16px; border: none; border-radius: 8px; background: transparent;
  color: #8a877c; font-size: 13px; cursor: pointer; font-family: inherit;
}
.pw-btn-ghost:hover { background: rgba(0,0,0,0.04); }
.pw-btn-primary {
  padding: 8px 20px; border: none; border-radius: 8px; background: #3d3591;
  color: #fff; font-size: 13px; font-weight: 500; cursor: pointer; font-family: inherit;
}
.pw-btn-primary:hover { background: #2f2875; }
.pw-btn-primary:disabled { opacity: 0.4; cursor: default; }

.modal-fade-enter-active { transition: opacity 0.2s; }
.modal-fade-leave-active { transition: opacity 0.15s; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }

/* ── 右键菜单 ── */
.ctx-backdrop { position: fixed; inset: 0; z-index: 300; }
.ctx-menu {
  position: fixed; z-index: 301;
  background: #fff; border: 0.5px solid rgba(0,0,0,0.08);
  border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);
  padding: 4px; min-width: 130px;
}
.ctx-menu button {
  display: block; width: 100%; padding: 7px 12px;
  border: none; border-radius: 6px;
  background: transparent; color: #4a4640;
  font-size: 12.5px; cursor: pointer; text-align: left;
  font-family: inherit; transition: background 0.1s;
}
.ctx-menu button:hover { background: rgba(0,0,0,0.04); }
.ctx-menu .ctx-danger { color: #b84b2e; }
.ctx-menu .ctx-danger:hover { background: #fef2f2; }
.ctx-menu .ctx-divider {
  border: none; border-top: 0.5px solid rgba(0,0,0,0.06); margin: 3px 6px;
}
.ctx-fade-enter-active { transition: opacity 0.1s; }
.ctx-fade-leave-active { transition: opacity 0.08s; }
.ctx-fade-enter-from, .ctx-fade-leave-to { opacity: 0; }
</style>
