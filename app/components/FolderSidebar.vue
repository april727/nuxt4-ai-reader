<template>
  <div class="folder-sidebar">
    <div class="fs-header">
      <h2 class="fs-title">书架</h2>
    </div>

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
        <svg class="fs-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span class="fs-name">{{ f.name }}</span>
        <span v-if="counts[f.id]" class="fs-count">{{ counts[f.id] }}</span>
        <button v-if="!['default'].includes(f.id)" class="fs-del" @click.stop="$emit('deleteFolder', f.id)" title="删除">×</button>
        <button class="fs-sub" @click.stop="$emit('addSub', f.id)" title="新建子文件夹">+</button>
      </div>
    </div>

    <div class="fs-create">
      <input v-if="creating" ref="newFolderInput" v-model="newFolderName" class="fs-input" placeholder="文件夹名称" @keydown.enter="createFolder" @keydown.escape="creating=false; newFolderName=''" @blur="creating=false; newFolderName=''" />
      <button v-else class="fs-add-btn" @click="startCreate">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>新建文件夹</span>
      </button>
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
.folder-sidebar { display: flex; flex-direction: column; height: 100%; background: #fafbfc; }
.fs-header { padding: 16px 20px 12px; }
.fs-title { font-size: 0.9em; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
.fs-list { flex: 1; overflow-y: auto; padding: 0 8px; }
.fs-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px; border: none; border-radius: 8px; background: transparent; color: #475569; font-size: 13px; cursor: pointer; transition: all 0.12s; text-align: left; }
.fs-item:hover { background: #f1f5f9; }
.fs-item.active { background: #eef2ff; color: #6366f1; font-weight: 500; }
.fs-icon { flex-shrink: 0; opacity: 0.5; }
.fs-item.active .fs-icon { opacity: 1; }
.fs-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-count { font-size: 11px; padding: 1px 6px; border-radius: 8px; background: #e2e8f0; color: #64748b; }
.fs-item.active .fs-count { background: #c7d2fe; color: #6366f1; }
.fs-del, .fs-sub { width: 20px; height: 20px; border: none; border-radius: 50%; background: transparent; color: #94a3b8; font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; opacity: 0; transition: all 0.12s; }
.fs-item:hover .fs-del, .fs-item:hover .fs-sub { opacity: 1; }
.fs-del:hover { background: #fee2e2; color: #ef4444; }
.fs-sub:hover { background: #e0e7ff; color: #6366f1; }
.fs-create { padding: 12px 16px; border-top: 1px solid #e8ecf1; }
.fs-add-btn { display: flex; align-items: center; gap: 6px; width: 100%; padding: 8px 12px; border: 1px dashed #cbd5e1; border-radius: 8px; background: transparent; color: #94a3b8; font-size: 12px; cursor: pointer; }
.fs-add-btn:hover { border-color: #6366f1; color: #6366f1; }
.fs-input { width: 100%; padding: 8px 12px; border: 1px solid #6366f1; border-radius: 8px; font-size: 13px; outline: none; background: #ffffff; }
</style>
