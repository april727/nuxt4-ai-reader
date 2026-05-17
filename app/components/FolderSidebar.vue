<template>
  <div class="folder-sidebar">
    <div class="fs-header">
      <svg class="fs-logo-icon" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
        <path d="M4 19V6a2 2 0 0 1 2-2h13a.5.5 0 0 1 .5.5v13"/>
        <path d="M4 19a2 2 0 0 0 2 2h13a.5.5 0 0 0 .5-.5V17"/>
        <path d="M4 19a2 2 0 0 1 2-2h13.5"/>
      </svg>
      <h2 class="fs-title">书架</h2>
    </div>

    <div class="fs-section-label">文件夹</div>

    <div class="fs-list">
      <div
        v-for="f in folders"
        :key="f.id"
        class="fs-item"
        role="button"
        tabindex="0"
        :class="{ active: activeFolder === f.id }"
        @click="$emit('select', f.id)"
        @dragover.prevent
        @dragenter.prevent="dragTarget = f.id"
        @dragleave.prevent="dragTarget = ''"
        @drop.prevent="$emit('dropOnFolder', f.id)"
      >
        <svg class="fs-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span class="fs-name">{{ f.name }}</span>
        <span v-if="counts[f.id]" class="fs-count">{{ counts[f.id] }}</span>
        <button v-if="!['default'].includes(f.id)" class="fs-del" @click.stop="$emit('deleteFolder', f.id)" title="删除">×</button>
        <button class="fs-sub" @click.stop="$emit('addSub', f.id)" title="新建子文件夹">+</button>
      </div>

      <!-- 新建文件夹 — 列表末尾 -->
      <div class="fs-item fs-new-item" v-if="!creating" @click="startCreate">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        <span class="fs-name">新建文件夹</span>
      </div>
      <div class="fs-item fs-new-input" v-else>
        <input ref="newFolderInput" v-model="newFolderName" class="fs-input" placeholder="文件夹名称" @keydown.enter="createFolder" @keydown.escape="creating=false; newFolderName=''" @blur="creating=false; newFolderName=''" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Folder { id: string; name: string; parent?: string }

const props = defineProps<{ folders: Folder[]; activeFolder: string; counts: Record<string, number> }>()
const emit = defineEmits<{ select: [id: string]; create: [name: string, parent?: string]; dropOnFolder: [id: string]; deleteFolder: [id: string]; addSub: [parentId: string] }>()

const creating = ref(false); const newFolderName = ref('')
const newFolderInput = ref<HTMLInputElement | null>(null); const dragTarget = ref('')
const creatingSub = ref('')

function startCreate() { creating.value = true; nextTick(() => newFolderInput.value?.focus()) }
async function createFolder() {
  const name = newFolderName.value.trim()
  if (!name) { creating.value = false; return }
  emit('create', name, creatingSub.value || undefined)
  newFolderName.value = ''; creating.value = false; creatingSub.value = ''
}

// 暴露给父组件用于子文件夹
defineExpose({ startSubCreate(parentId: string) { creatingSub.value = parentId; startCreate() } })
</script>

<style scoped>
.folder-sidebar { display: flex; flex-direction: column; height: 100%; background: transparent; font-family: 'DM Sans', sans-serif; }
.fs-header { display: flex; align-items: center; gap: 10px; padding: 28px 20px 0 24px; }
.fs-logo-icon { flex-shrink: 0; color: #1a1a18; width: 30px; height: 30px; stroke-width: 1.6; }
.fs-title { font-family: 'Lora', Georgia, serif; font-size: 26px; font-weight: 500; color: #1a1a18; }
.fs-section-label {
  font-size: 10.5px; font-weight: 500; color: #a09e97; letter-spacing: 0.07em;
  text-transform: uppercase; padding: 0 10px; margin: 28px 0 6px 18px;
}
.fs-list { flex: 1; overflow-y: auto; padding: 0 10px 0 16px; }
.fs-item {
  display: flex; align-items: center; gap: 9px; width: 100%; padding: 8px 10px 8px 14px;
  border: 0.5px solid transparent; border-radius: 9px; background: transparent;
  color: #6b6963; font-size: 14px; cursor: pointer; transition: background 0.12s, color 0.12s; text-align: left;
  margin-bottom: 2px;
}
.fs-item:hover { background: rgba(0,0,0,0.04); color: #1a1a18; }
.fs-item.active {
  background: #ffffff;
  border-color: rgba(0,0,0,0.08);
  color: #1a1a18;
  font-weight: 500;
}
.fs-icon { flex-shrink: 0; opacity: 0.6; color: #6b6963; }
.fs-item.active .fs-icon { opacity: 1; }
.fs-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-count { font-size: 12px; color: #b0ae9f; font-family: 'DM Mono', monospace; font-weight: 400; }
.fs-del, .fs-sub { width: 22px; height: 22px; border: none; border-radius: 50%; background: transparent; color: #a09e97; font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; opacity: 0; transition: all 0.12s; font-family: 'DM Sans', sans-serif; }
.fs-item:hover .fs-del, .fs-item:hover .fs-sub { opacity: 1; }
.fs-del:hover { background: #fce9e5; color: #b84b2e; }
.fs-sub:hover { background: rgba(0,0,0,0.06); color: #4a4a46; }
/* 新建文件夹 — 列表内样式 */
.fs-new-item { color: #a09e97; }
.fs-new-item:hover { color: #6b6963; background: rgba(0,0,0,0.04); }
.fs-new-input { padding: 0 2px; cursor: default; }
.fs-new-input:hover { background: transparent; }
.fs-input { width: 100%; padding: 8px 10px; border: 1px solid #3d3591; border-radius: 8px; font-size: 13px; outline: none; background: #ffffff; color: #1a1a18; font-family: 'DM Sans', sans-serif; }
.fs-input::placeholder { color: #c0bdb4; }
</style>
