<template>
  <div class="folder-sidebar">
    <!-- 头部 -->
    <div class="fs-header">
      <svg class="fs-logo-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
        <path d="M4 19V6a2 2 0 0 1 2-2h13a.5.5 0 0 1 .5.5v13"/>
        <path d="M4 19a2 2 0 0 0 2 2h13a.5.5 0 0 0 .5-.5V17"/>
        <path d="M4 19a2 2 0 0 1 2-2h13.5"/>
      </svg>
      <h2 class="fs-title" @click="handleTitleClick">书架</h2>
      <span v-if="showPrivate" class="fs-private-indicator">·</span>
    </div>

    <!-- 文件夹列表 -->
    <div class="fs-section-label">文件夹</div>
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

      <!-- 私密切换提示行 -->
      <div v-if="hasPrivate && !showPrivate" class="fs-private-hint">
        <span class="fs-private-dots">···</span>
      </div>

      <!-- 新建文件夹 -->
      <div class="fs-card fs-new-card" v-if="!creating" @click="startCreate">
        <div class="fsc-body" style="justify-content: center">
          <div class="fsc-top" style="justify-content: center; gap: 6px; color: #b0aca0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            <span class="fsc-name" style="font-size: 12.5px">新建文件夹</span>
          </div>
        </div>
      </div>
      <div class="fs-card fs-new-input" v-else>
        <input ref="newFolderInput" v-model="newFolderName" class="fs-input" :placeholder="creatingSub ? '子文件夹名称' : '文件夹名称'" @keydown.enter="createFolder" @keydown.escape="creating=false; newFolderName=''; creatingSub=''" @blur="creating=false; newFolderName=''; creatingSub=''" />
      </div>
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

const visibleFolders = computed(() => {
  if (showPrivate.value) return rootFolders.value
  return rootFolders.value.filter((f: any) => !f.isPrivate)
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
}

.fs-header {
  display: flex; align-items: center; gap: 8px;
  padding: 24px 16px 0 20px;
}
.fs-logo-icon { flex-shrink: 0; color: #1a1a18; }
.fs-title {
  font-family: 'Lora', Georgia, serif; font-size: 22px; font-weight: 500;
  color: #1a1a18; cursor: default; user-select: none; margin: 0;
}
.fs-private-indicator {
  font-size: 10px; color: #c4c0b8; margin-left: 2px; font-weight: 600;
}

/* ── Section label ── */
.fs-section-label {
  font-size: 10px; font-weight: 500; color: #b0aca0;
  letter-spacing: 0.07em; text-transform: uppercase;
  padding: 22px 16px 8px 22px;
}

/* ── List / Cards ── */
.fs-list {
  flex: 1; overflow-y: auto;
  padding: 0 10px 10px;
  display: flex; flex-direction: column; gap: 4px;
}

/* ── Card ── */
.fs-card {
  display: flex; align-items: stretch; gap: 0;
  border-radius: 10px; border: 0.5px solid transparent;
  background: transparent; cursor: pointer;
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
  position: relative; overflow: hidden;
  min-height: 52px;
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
  padding: 8px 0 8px 10px;
  display: flex; flex-direction: column; justify-content: center; gap: 3px;
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
.fs-sub-card { margin-left: 16px; min-height: 40px; }
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

/* ── 私密切换提示 ── */
.fs-private-hint { text-align: center; padding: 6px 0; }
.fs-private-dots { color: #d4d1c8; font-size: 16px; letter-spacing: 3px; }

/* ── 新建文件夹 ── */
.fs-new-card { opacity: 0.55; }
.fs-new-card:hover { opacity: 0.8; }
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
