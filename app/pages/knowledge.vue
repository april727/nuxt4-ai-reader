<template>
  <div class="kp-page">
    <!-- 左侧分组栏 -->
    <aside class="kp-sidebar" :class="{ collapsed: sidebarCollapsed }">
      <div v-if="!sidebarCollapsed" class="kp-sidebar-inner">
        <div class="kp-sidebar-header">
          <button class="back-btn" @click="navigateTo('/')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="kp-sidebar-title">知识要点</span>
          <button class="kp-collapse-toggle" @click="sidebarCollapsed = true" title="收起侧栏">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        </div>
      <div class="kp-groups-list">
        <!-- 来源资料（可折叠） -->
        <div v-if="sourceGroups.length" class="kp-groups-section">
          <button class="kp-groups-label kp-groups-label-toggle" @click="sourceCollapsed = !sourceCollapsed">
            <svg class="kp-collapse-arrow" :class="{ open: !sourceCollapsed }" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            <span>来源资料</span>
          </button>
          <div v-show="!sourceCollapsed">
            <button
              v-for="group in sourceGroups"
              :key="group.key"
              class="kp-group-item"
              :class="{ active: activeGroup === group.key }"
              @click="selectGroup(group.key)"
              draggable="false"
              @dragover.prevent
              @drop="onDropToGroup($event, group.key)"
            >
              <span class="kp-group-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </span>
              <span class="kp-group-name">{{ group.label }}</span>
              <span class="kp-group-count">{{ group.count }}</span>
            </button>
          </div>
        </div>

        <!-- 自定义分组 -->
        <div class="kp-groups-section">
          <div class="kp-groups-label">
            <span>自定义分组</span>
            <button class="kp-group-add" @click="startCreateGroup" title="新建分组">+</button>
          </div>
          <div v-if="creatingGroup" class="kp-group-item kp-group-editing">
            <input v-model="newGroupName" class="kp-group-input" placeholder="分组名" @keydown.enter="confirmCreateGroup" @keydown.escape="creatingGroup = false" autofocus />
          </div>
          <button
            v-for="group in customGroups"
            :key="group.key"
            class="kp-group-item"
            :class="{ active: activeGroup === group.key }"
            @click="selectGroup(group.key)"
            @dragover.prevent
            @drop="onDropToGroup($event, group.key)"
            @contextmenu.prevent="groupMenu = { key: group.key, x: $event.clientX, y: $event.clientY }"
          >
            <span class="kp-group-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </span>
            <span v-if="editingGroup === group.key" class="kp-group-name">
              <input v-model="editGroupName" class="kp-group-input" @keydown.enter="confirmRenameGroup" @keydown.escape="editingGroup = ''" @blur="confirmRenameGroup" autofocus />
            </span>
            <span v-else class="kp-group-name" @dblclick.stop="startRenameGroup(group.key, group.label)">{{ group.label }}</span>
            <span class="kp-group-count">{{ group.count }}</span>
          </button>
        </div>
      </div>

      <!-- 分组右键菜单 -->
      <Teleport to="body">
        <div v-if="groupMenu.key" class="kp-context-menu" :style="{ left: groupMenu.x + 'px', top: groupMenu.y + 'px' }" @click.stop @mouseleave="groupMenu = { key: '', x: 0, y: 0 }">
          <button @click="startRenameGroup(groupMenu.key, customGroups.find(g => g.key === groupMenu.key)?.label || ''); groupMenu = { key: '', x: 0, y: 0 }">重命名</button>
          <button @click="deleteGroup(groupMenu.key); groupMenu = { key: '', x: 0, y: 0 }">删除分组</button>
        </div>
      </Teleport>

        <div class="kp-sidebar-footer">
          <button class="kp-sync-btn" :disabled="syncing" @click="syncNotes">{{ syncing ? '同步中...' : '同步笔记' }}</button>
          <span class="kp-total">{{ totalCount }} 条</span>
        </div>
      </div>
      <!-- 收起态：细条 -->
      <div v-if="sidebarCollapsed" class="kp-sidebar-strip" @click="sidebarCollapsed = false" title="展开侧栏">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </aside>

    <!-- ── 自定义分组：中间页面列表 ── -->
    <div class="kp-list" v-if="activeGroup && isCustom" :class="{ collapsed: listCollapsed }">
      <div v-if="!listCollapsed" class="kp-list-inner">
        <div class="kp-list-header">
          <span class="kp-list-title">{{ activeGroupLabel }}</span>
          <button class="kp-page-add-btn" @click="createPage" title="新建页面">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>新建</span>
          </button>
          <button class="kp-collapse-toggle" @click="listCollapsed = true" title="收起列表">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        </div>
      <div class="kp-list-items">
        <div
          v-for="page in pages"
          :key="page.id"
          class="kp-list-item kp-page-item"
          :class="{ active: selectedPageId === page.id }"
          @click="selectPage(page.id)"
          @dblclick.stop="startRenamePage(page.id, page.title)"
          @contextmenu.prevent="pageMenu = { id: page.id, x: $event.clientX, y: $event.clientY }"
        >
          <div class="kp-list-item-meta">
            <span class="kp-list-item-type">页面</span>
            <span class="kp-list-item-date">{{ formatDate(page.updatedAt) }}</span>
          </div>
          <p v-if="renamingPageId !== page.id" class="kp-list-item-text">{{ page.title }}</p>
          <input
            v-else
            v-model="renamePageName"
            :ref="focusRenameInput"
            class="kp-group-input"
            @keydown.enter="confirmRenamePage(page.id)"
            @keydown.escape="renamingPageId = ''"
            @blur="confirmRenamePage(page.id)"
            @click.stop
          />
        </div>
        <div v-if="pages.length === 0" class="kp-list-empty">
          <p>暂无页面</p>
          <p class="kp-list-empty-hint">点击上方「+ 新建」创建整理页面</p>
        </div>
      </div>
      <!-- 页面右键菜单 -->
      <Teleport to="body">
        <div v-if="pageMenu.id" class="kp-context-menu" :style="{ left: pageMenu.x + 'px', top: pageMenu.y + 'px' }" @click.stop @mouseleave="pageMenu = { id: '', x: 0, y: 0 }">
          <button @click="startRenamePage(pageMenu.id, pages.find(p => p.id === pageMenu.id)?.title || ''); pageMenu = { id: '', x: 0, y: 0 }">重命名</button>
          <button @click="deletePage(pageMenu.id); pageMenu = { id: '', x: 0, y: 0 }">删除页面</button>
        </div>
      </Teleport>
      </div>
      <!-- 收起态：细条 -->
      <div v-if="listCollapsed" class="kp-list-strip" @click="listCollapsed = false" title="展开列表">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>

    <!-- ── 来源分组：中间知识要点列表 ── -->
    <div class="kp-list" v-else-if="activeGroup && !isCustom" :class="{ collapsed: listCollapsed }">
      <div v-if="!listCollapsed" class="kp-list-inner">
        <div class="kp-list-header">
          <span class="kp-list-title">{{ activeGroupLabel }}</span>
          <span class="kp-list-count">{{ activeItems.length }} 条</span>
          <button class="kp-collapse-toggle" @click="listCollapsed = true" title="收起列表">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        </div>
      <div class="kp-list-items">
        <div
          v-for="item in activeItems"
          :key="item.id"
          class="kp-list-item"
          :class="{ active: selectedId === item.id }"
          :draggable="true"
          @dragstart="onDragStart($event, item)"
          @click="selectKpItem(item.id)"
        >
          <div class="kp-list-item-meta">
            <span class="kp-list-item-type">{{ typeLabel(item.sourceType) }}</span>
            <span class="kp-list-item-date">{{ formatDate(item.createdAt) }}</span>
          </div>
          <p class="kp-list-item-text">{{ item.content.slice(0, 80) }}{{ item.content.length > 80 ? '...' : '' }}</p>
        </div>
        <div v-if="activeItems.length === 0" class="kp-list-empty">
          <p>暂无内容</p>
          <p class="kp-list-empty-hint">从其他分组拖拽笔记到这里</p>
        </div>
      </div>
      </div>
      <!-- 收起态：细条 -->
      <div v-if="listCollapsed" class="kp-list-strip" @click="listCollapsed = false" title="展开列表">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>

    <div v-else class="kp-list kp-list-placeholder">
      <div class="kp-list-empty">选择左侧分组</div>
    </div>

    <!-- ── 右侧：自定义分组 → 富文本编辑器 ── -->
    <main class="kp-detail" v-if="isCustom && selectedPage">
      <div class="kp-detail-header">
        <div class="kp-detail-header-left">
          <input
            class="kp-page-title-input"
            :value="selectedPage.title"
            @input="onPageTitleInput"
            placeholder="页面标题"
          />
        </div>
        <button class="kp-detail-del" @click="deletePage(selectedPage.id)">删除</button>
      </div>
      <div class="kp-detail-body kp-detail-editor">
        <RichEditor v-model="pageContent" />
      </div>
    </main>

    <!-- ── 右侧：自定义分组未选页面时 ── -->
    <div v-else-if="isCustom && !selectedPage" class="kp-detail kp-detail-placeholder">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#d0cdc6" stroke-width="1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
      <p>选择或新建一个页面开始整理</p>
    </div>

    <!-- ── 右侧：来源分组 → 详情 + AI 对话 ── -->
    <main class="kp-detail" v-else-if="selectedItem">
      <div class="kp-detail-header">
        <div class="kp-detail-header-left">
          <span class="kp-detail-type">{{ typeLabel(selectedItem.sourceType) }}</span>
          <span class="kp-detail-source" v-if="selectedItem.sourceTitle">{{ selectedItem.sourceTitle }}</span>
          <span class="kp-detail-date">{{ formatDate(selectedItem.createdAt) }}</span>
        </div>
        <button class="kp-detail-del" @click="deleteKpItem(selectedItem.id)">删除</button>
      </div>
      <div class="kp-detail-body">
        <PodcastNoteView v-if="selectedItem.sourceType === 'podcast_note'" :content="selectedItem.content" />
        <div v-else class="kp-detail-content" v-html="renderContent(selectedItem)"></div>
        <div class="kp-chat">
          <div class="kp-chat-messages" ref="chatMsgsRef">
            <div v-for="(msg, i) in chatMessages" :key="i" class="kp-chat-msg" :class="msg.role">
              <div class="kp-chat-msg-content" v-html="renderChatMsg(msg.content)"></div>
            </div>
          </div>
          <div class="kp-chat-input-row">
            <input v-model="chatInput" class="kp-chat-input" placeholder="与 AI 交流..." @keydown.enter="sendChat" :disabled="chatLoading" />
            <button class="kp-chat-send" @click="sendChat" :disabled="chatLoading || !chatInput.trim()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>
      </div>
    </main>

    <div v-else class="kp-detail kp-detail-placeholder">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#d0cdc6" stroke-width="1"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      <p>选择一条知识要点查看详情</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { marked } from 'marked'
import PodcastNoteView from '~/components/PodcastNoteView.vue'

interface KpItem {
  id: string; content: string; note: string; _note: string
  sourceId: string; sourceTitle: string; sourceType: string; sourceContext: string
  customGroup: string; chatHistory: Array<{ role: string; content: string }>
  tags: string[]; sortOrder: number; createdAt: string
}

interface KpPage {
  id: string; groupId: string; title: string; content: string
  createdAt: string; updatedAt: string
}

useHead({ title: '知识要点' })

const loading = ref(true); const syncing = ref(false)
const activeGroup = ref(''); const selectedId = ref<string | null>(null)
const items = ref<KpItem[]>([])

// ── 页面系统 ──
const pages = ref<KpPage[]>([])
const selectedPageId = ref<string | null>(null)
const pageContent = ref('')
const pageContentTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const sourceCollapsed = ref(false)
const sidebarCollapsed = ref(false)
const listCollapsed = ref(false)
const pageMenu = reactive({ id: '', x: 0, y: 0 })
const renamingPageId = ref('')
const renamePageName = ref('')

// ── 分组操作 ──
const creatingGroup = ref(false); const newGroupName = ref('')
const editingGroup = ref(''); const editGroupName = ref('')
const groupMenu = reactive({ key: '', x: 0, y: 0 })
const dragItemId = ref<string | null>(null)

const totalCount = computed(() => items.value.length)

// 分组 key
function getGroupKey(item: KpItem) {
  if (item.customGroup) return item.customGroup
  if (item.sourceType === 'podcast_note') return 'src:podcast'
  return `src:${item.sourceTitle || '未分类'}`
}
function isCustomGroup(key: string) { return !key.startsWith('src:') }
const isCustom = computed(() => isCustomGroup(activeGroup.value))

// ── 来源分组 ──
const podcastItems = computed(() => items.value.filter(i => i.sourceType === 'podcast_note' && !i.customGroup))
const nonPodcastItems = computed(() => items.value.filter(i => i.sourceType !== 'podcast_note'))

const sourceGroups = computed(() => {
  const map = new Map<string, { label: string; count: number }>()
  if (podcastItems.value.length) map.set('src:podcast', { label: '播客笔记', count: podcastItems.value.length })
  for (const item of nonPodcastItems.value) {
    if (item.customGroup) continue
    const key = `src:${item.sourceTitle || '未分类'}`
    if (!map.has(key)) map.set(key, { label: item.sourceTitle || '未分类', count: 0 })
    map.get(key)!.count++
  }
  return Array.from(map.entries()).map(([key, v]) => ({ key, label: v.label, count: v.count }))
    .filter(g => g.count > 0).sort((a, b) => b.count - a.count)
})

// ── 自定义分组 ──
const customGroups = computed(() => {
  const map = new Map<string, number>()
  for (const item of items.value) {
    if (!item.customGroup) continue
    map.set(item.customGroup, (map.get(item.customGroup) || 0) + 1)
  }
  return Array.from(map.entries()).map(([key, count]) => ({ key, label: key, count }))
})

const allGroups = computed(() => [...sourceGroups.value, ...customGroups.value])
const activeGroupLabel = computed(() => allGroups.value.find(g => g.key === activeGroup.value)?.label || '')
const activeItems = computed(() => items.value.filter(i => getGroupKey(i) === activeGroup.value))
const selectedItem = computed(() => items.value.find(i => i.id === selectedId.value) || null)
const selectedPage = computed(() => pages.value.find(p => p.id === selectedPageId.value) || null)

// ── 分组操作 ──
function selectGroup(key: string) {
  activeGroup.value = key
  selectedId.value = null
  selectedPageId.value = null
  if (isCustomGroup(key)) {
    loadPages()
  } else {
    nextTick(() => { const f = activeItems.value[0]; if (f) selectedId.value = f.id })
  }
}

function selectKpItem(id: string) { selectedId.value = id; selectedPageId.value = null }
function selectPage(id: string) {
  selectedPageId.value = id
  selectedId.value = null
  nextTick(() => {
    pageContent.value = selectedPage.value?.content || ''
  })
}

// ── 页面 CRUD ──
async function loadPages() {
  if (!isCustom.value) return
  try {
    pages.value = await $fetch<KpPage[]>(`/api/pages/list?groupId=${encodeURIComponent(activeGroup.value)}`)
  } catch { pages.value = [] }
}

async function createPage() {
  if (!isCustom.value) return
  try {
    const page = await $fetch<KpPage>('/api/pages/create', {
      method: 'POST',
      body: { groupId: activeGroup.value, title: '未命名页面' },
    })
    await loadPages()
    selectPage(page.id)
  } catch {}
}

async function deletePage(id: string) {
  try {
    await $fetch(`/api/pages/${id}`, { method: 'DELETE' })
    if (selectedPageId.value === id) { selectedPageId.value = null; pageContent.value = '' }
    await loadPages()
  } catch {}
}

function startRenamePage(id: string, title: string) {
  renamingPageId.value = id
  renamePageName.value = title
}

function focusRenameInput(el: any) {
  if (el) {
    ;(el as HTMLInputElement).focus()
    ;(el as HTMLInputElement).select()
  }
}

async function confirmRenamePage(id: string) {
  const newName = renamePageName.value.trim()
  renamingPageId.value = ''
  if (!newName) return
  // 乐观更新本地列表
  pages.value = pages.value.map(p => p.id === id ? { ...p, title: newName } : p)
  await $fetch(`/api/pages/${id}`, {
    method: 'PUT',
    body: { title: newName },
  }).catch(() => {})
}

function onPageTitleInput(e: Event) {
  const val = (e.target as HTMLInputElement).value
  if (!selectedPage.value) return
  pages.value = pages.value.map(p => p.id === selectedPage.value!.id ? { ...p, title: val } : p)
  // 防抖保存标题
  if (pageContentTimer.value) clearTimeout(pageContentTimer.value)
  pageContentTimer.value = setTimeout(async () => {
    if (!selectedPage.value) return
    await $fetch(`/api/pages/${selectedPage.value.id}`, {
      method: 'PUT',
      body: { title: val },
    }).catch(() => {})
  }, 800)
}

// 富文本内容防抖保存
watch(pageContent, (val) => {
  if (!selectedPage.value) return
  if (pageContentTimer.value) clearTimeout(pageContentTimer.value)
  pageContentTimer.value = setTimeout(async () => {
    if (!selectedPage.value) return
    await $fetch(`/api/pages/${selectedPage.value.id}`, {
      method: 'PUT',
      body: { content: val },
    }).catch(() => {})
  }, 1200)
})

// ── 分组 CRUD ──
function startCreateGroup() { creatingGroup.value = true; newGroupName.value = '' }
async function confirmCreateGroup() {
  const name = newGroupName.value.trim(); if (!name) { creatingGroup.value = false; return }
  const first = activeItems.value[0]
  if (first) {
    await $fetch('/api/knowledge/group', { method: 'PATCH', body: { action: 'create', groupName: name, itemId: first.id } })
    await loadItems(); selectGroup(name)
  }
  creatingGroup.value = false; newGroupName.value = ''
}

function startRenameGroup(key: string, label: string) { editingGroup.value = key; editGroupName.value = label; nextTick(() => { (document.querySelector('.kp-group-input') as HTMLInputElement)?.focus() }) }
async function confirmRenameGroup() {
  const oldName = editingGroup.value; const newName = editGroupName.value.trim()
  if (!oldName || !newName || oldName === newName) { editingGroup.value = ''; return }
  await $fetch('/api/knowledge/group', { method: 'PATCH', body: { action: 'rename', oldName, newName } })
  await loadItems(); if (activeGroup.value === oldName) activeGroup.value = newName
  editingGroup.value = ''
}

async function deleteGroup(key: string) {
  await $fetch('/api/knowledge/group', { method: 'PATCH', body: { action: 'delete', groupName: key } })
  if (activeGroup.value === key) activeGroup.value = allGroups.value[0]?.key || ''
  await loadItems()
}

// ── 拖拽 ──
function onDragStart(e: DragEvent, item: KpItem) { dragItemId.value = item.id; e.dataTransfer!.effectAllowed = 'move' }
async function onDropToGroup(e: DragEvent, toGroup: string) {
  if (!dragItemId.value) return
  const toGroupName = isCustomGroup(toGroup) ? toGroup : ''
  await $fetch('/api/knowledge/group', { method: 'PATCH', body: { action: 'move', itemId: dragItemId.value, toGroup: toGroupName } })
  await loadItems(); dragItemId.value = null
}

// ── AI 对话 ──
const chatInput = ref(''); const chatLoading = ref(false)
const chatMessages = ref<Array<{ role: string; content: string }>>([])
const chatMsgsRef = ref<HTMLElement | null>(null)

watch(selectedId, () => {
  chatMessages.value = selectedItem.value?.chatHistory?.length ? [...selectedItem.value.chatHistory] : []
  chatInput.value = ''
})

async function sendChat() {
  const text = chatInput.value.trim(); if (!text || chatLoading.value || !selectedItem.value) return
  chatInput.value = ''; chatMessages.value.push({ role: 'user', content: text })
  chatMessages.value.push({ role: 'assistant', content: '' })
  const msgIdx = chatMessages.value.length - 1
  chatLoading.value = true; await nextTick(); chatMsgsRef.value?.scrollTo({ top: chatMsgsRef.value.scrollHeight, behavior: 'smooth' })

  try {
    const context = `知识要点内容："""${selectedItem.value.content.slice(0, 3000)}"""。来源：${selectedItem.value.sourceTitle || '未知'}。`
    const msgs = [{ role: 'system', content: context }, ...chatMessages.value.slice(0, -1).map(m => ({ role: m.role, content: m.content }))]
    const resp = await fetch('/api/deepseek/stream', { method: 'POST', body: JSON.stringify({ messages: msgs }), headers: { 'Content-Type': 'application/json' } })
    if (!resp.ok || !resp.body) throw new Error('Stream failed')
    const reader = resp.body.getReader(); const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chatMessages.value[msgIdx].content += decoder.decode(value, { stream: true })
      nextTick(() => { chatMsgsRef.value?.scrollTo({ top: chatMsgsRef.value.scrollHeight, behavior: 'smooth' }) })
    }
  } catch { chatMessages.value[msgIdx].content = chatMessages.value[msgIdx].content || 'AI 服务暂时不可用' }
  finally {
    chatLoading.value = false
    if (selectedItem.value) {
      $fetch(`/api/knowledge/${selectedItem.value.id}/chat`, {
        method: 'PUT',
        body: { chatHistory: chatMessages.value },
      }).catch(() => {})
    }
  }
}

function renderContent(item: KpItem) { return item.content.replace(/\n/g, '<br>') }
function renderChatMsg(c: string) { try { return marked.parse(c, { breaks: true, gfm: true }) } catch { return c } }
function typeLabel(t: string) { return { note: '笔记', podcast_note: '播客', ai_qa: 'AI', 'ai-chat': 'AI', selection: '选中', manual: '手动' }[t] || t }
function formatDate(d: string) { if (!d) return ''; const date = new Date(d); return `${date.getMonth() + 1}/${date.getDate()}` }

async function syncNotes() { syncing.value = true; try { await $fetch('/api/knowledge/sync-notes', { method: 'POST' }); await loadItems() } catch {} finally { syncing.value = false } }
async function loadItems() {
  loading.value = true
  try { const data = await $fetch<KpItem[]>('/api/knowledge/list'); items.value = data; if (!activeGroup.value && allGroups.value.length) selectGroup(allGroups.value[0].key) } catch {}
  finally { loading.value = false }
}
async function deleteKpItem(id: string) {
  try { await $fetch(`/api/knowledge/${id}`, { method: 'DELETE' }); items.value = items.value.filter(i => i.id !== id); if (selectedId.value === id) selectedId.value = null } catch {}
}

onMounted(() => { loadItems() })
onMounted(() => document.addEventListener('click', () => { groupMenu.key = ''; pageMenu.id = '' }))
</script>

<style scoped>
.kp-page { display: flex; height: 100vh; background: #f7f6f3; }

.kp-sidebar { width: 190px; flex-shrink: 0; display: flex; flex-direction: column; border-right: 0.5px solid rgba(0,0,0,0.06); background: #f0efe9; }
.kp-sidebar-header { display: flex; align-items: center; gap: 6px; padding: 14px 12px; border-bottom: 0.5px solid rgba(0,0,0,0.05); }
.kp-sidebar-title { font-size: 13.5px; font-weight: 600; color: #1a1a18; }
.kp-groups-list { flex: 1; overflow-y: auto; padding: 4px 6px; }
.kp-groups-section { margin-bottom: 8px; }
.kp-groups-label { font-size: 10px; font-weight: 600; color: #a09e97; text-transform: uppercase; letter-spacing: 0.04em; padding: 8px 10px 4px; display: flex; align-items: center; justify-content: space-between; }
.kp-groups-label-toggle { width: 100%; border: none; background: transparent; cursor: pointer; font-family: 'DM Sans', sans-serif; gap: 4px; justify-content: flex-start; }
.kp-groups-label-toggle:hover { color: #6b6963; }
.kp-collapse-arrow { transition: transform 0.2s; flex-shrink: 0; color: #b0ad9d; }
.kp-collapse-arrow.open { transform: rotate(90deg); }
.kp-group-add { width: 18px; height: 18px; border-radius: 4px; border: none; background: transparent; color: #a09e97; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; }
.kp-group-add:hover { background: rgba(0,0,0,0.05); color: #3d3591; }
.kp-group-item { display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-radius: 7px; border: none; background: transparent; color: #4a4a46; font-size: 12px; cursor: pointer; transition: all 0.15s; text-align: left; font-family: 'DM Sans', sans-serif; width: 100%; }
.kp-group-item:hover { background: rgba(0,0,0,0.04); }
.kp-group-item.active { background: #fff; color: #3d3591; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
.kp-group-icon { display: flex; color: #a09e97; flex-shrink: 0; }
.kp-group-item.active .kp-group-icon { color: #3d3591; }
.kp-group-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kp-group-count { font-size: 10.5px; color: #b0ad9d; font-family: 'DM Mono', monospace; }
.kp-group-editing { padding: 4px 10px; background: #fff; }
.kp-group-input { width: 100%; border: none; outline: none; font-size: 12px; font-family: 'DM Sans', sans-serif; color: #1a1a18; background: transparent; }
.kp-sidebar-footer { padding: 10px 12px; border-top: 0.5px solid rgba(0,0,0,0.05); display: flex; align-items: center; gap: 8px; }
.kp-sync-btn { padding: 4px 8px; border-radius: 5px; border: 0.5px solid rgba(0,0,0,0.12); background: #fff; font-size: 11px; cursor: pointer; color: #6b6963; font-family: 'DM Sans', sans-serif; }
.kp-sync-btn:hover { border-color: #3d3591; color: #3d3591; }
.kp-sync-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.kp-total { font-size: 10.5px; color: #a09e97; font-family: 'DM Mono', monospace; margin-left: auto; }

.kp-context-menu { position: fixed; z-index: 2000; background: #fff; border: 0.5px solid rgba(0,0,0,0.08); border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); padding: 4px; display: flex; flex-direction: column; }
.kp-context-menu button { padding: 8px 14px; border: none; background: transparent; font-size: 12px; color: #4a4a46; cursor: pointer; text-align: left; border-radius: 5px; font-family: 'DM Sans', sans-serif; }
.kp-context-menu button:hover { background: rgba(0,0,0,0.04); }

/* 中间列表 */
.kp-list { width: 260px; flex-shrink: 0; display: flex; flex-direction: column; border-right: 0.5px solid rgba(0,0,0,0.06); background: #fff; }
.kp-list-header { display: flex; align-items: center; gap: 8px; padding: 14px 16px 10px; border-bottom: 0.5px solid rgba(0,0,0,0.05); flex-shrink: 0; }
.kp-list-title { font-size: 13px; font-weight: 600; color: #1a1a18; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.kp-list-count { font-size: 10.5px; color: #a09e97; font-family: 'DM Mono', monospace; }
.kp-page-add-btn {
  display: flex; align-items: center; gap: 3px; padding: 4px 10px; border-radius: 6px;
  border: 0.5px solid rgba(61,53,145,0.2); background: #faf9fe;
  color: #3d3591; font-size: 11px; cursor: pointer; font-family: 'DM Sans', sans-serif;
  white-space: nowrap; transition: all 0.12s;
}
.kp-page-add-btn:hover { background: #edeafd; border-color: #3d3591; }
.kp-list-items { flex: 1; overflow-y: auto; padding: 4px 8px; display: flex; flex-direction: column; gap: 2px; }
.kp-list-item { padding: 10px 12px; border-radius: 8px; cursor: pointer; transition: background 0.12s; border: 0.5px solid transparent; }
.kp-list-item:hover { background: #f5f4f0; }
.kp-list-item.active { background: #f0edfa; border-color: rgba(61,53,145,0.1); }
.kp-list-item-meta { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
.kp-list-item-type { font-size: 9.5px; padding: 1px 5px; border-radius: 3px; background: #f0edfa; color: #3d3591; font-weight: 500; }
.kp-list-item-date { font-size: 10px; color: #b0ad9d; font-family: 'DM Mono', monospace; }
.kp-list-item-text { font-size: 12.5px; line-height: 1.5; color: #4a4a46; margin: 0; font-family: 'Lora', Georgia, serif; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.kp-page-item { cursor: pointer; }
.kp-list-empty { padding: 40px 16px; text-align: center; color: #c0bdb4; font-size: 13px; }
.kp-list-empty-hint { font-size: 11px; color: #d0cdc6; margin-top: 4px; }
.kp-list-placeholder { display: flex; align-items: center; justify-content: center; }

/* 右侧详情 / 编辑器 */
.kp-detail { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: #fafaf8; }
.kp-detail-header { display: flex; align-items: center; gap: 8px; padding: 12px 20px; border-bottom: 0.5px solid rgba(0,0,0,0.05); flex-shrink: 0; background: #fff; }
.kp-detail-header-left { display: flex; align-items: center; gap: 8px; flex: 1; }
.kp-detail-type { font-size: 10px; padding: 2px 6px; border-radius: 3px; background: #f0edfa; color: #3d3591; font-weight: 500; }
.kp-detail-source { font-size: 12px; color: #6b6963; }
.kp-detail-date { font-size: 11px; color: #b0ad9d; font-family: 'DM Mono', monospace; }
.kp-detail-del { padding: 4px 10px; border-radius: 5px; border: none; background: transparent; font-size: 11px; color: #a09e97; cursor: pointer; }
.kp-detail-del:hover { color: #dc2626; }
.kp-detail-body { flex: 1; overflow-y: auto; padding: 0; display: flex; flex-direction: column; }
.kp-detail-editor { padding: 0; }
.kp-detail-content { font-size: 14px; line-height: 1.8; color: #1a1a18; font-family: 'Lora', Georgia, serif; white-space: pre-wrap; padding: 20px 20px 24px; border-bottom: 0.5px solid rgba(0,0,0,0.06); }
.kp-detail-content :deep(p) { margin: 0.5em 0; }

/* 页面标题输入 */
.kp-page-title-input {
  border: none; outline: none; font-size: 15px; font-weight: 600; color: #1a1a18;
  font-family: 'DM Sans', sans-serif; background: transparent; width: 100%;
}
.kp-page-title-input::placeholder { color: #c0bdb4; }

/* AI 对话框 */
.kp-chat { margin: 0 20px 20px; flex: 1; display: flex; flex-direction: column; min-height: 0; }
.kp-chat-messages { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-bottom: 8px; }
.kp-chat-msg { max-width: 90%; }
.kp-chat-msg.user { align-self: flex-end; }
.kp-chat-msg.assistant { align-self: flex-start; }
.kp-chat-msg-content { padding: 8px 12px; border-radius: 10px; font-size: 12.5px; line-height: 1.6; }
.kp-chat-msg.user .kp-chat-msg-content { background: #3d3591; color: #fff; }
.kp-chat-msg.assistant .kp-chat-msg-content { background: #f0efea; color: #1a1a18; }
.kp-chat-input-row { display: flex; gap: 6px; margin-top: 8px; flex-shrink: 0; }
.kp-chat-input { flex: 1; border: 0.5px solid rgba(0,0,0,0.12); border-radius: 8px; padding: 8px 12px; font-size: 12.5px; font-family: 'DM Sans', sans-serif; color: #1a1a18; outline: none; }
.kp-chat-input:focus { border-color: #3d3591; }
.kp-chat-send { width: 34px; height: 34px; border-radius: 8px; border: none; background: #3d3591; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.kp-chat-send:hover { background: #332d7a; }
.kp-chat-send:disabled { opacity: 0.4; cursor: not-allowed; }
.kp-detail-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: #c0bdb4; font-size: 13px; }

.back-btn {
  width: 28px; height: 28px; border-radius: 6px; border: none; background: transparent;
  color: #6b6963; cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.back-btn:hover { background: rgba(0,0,0,0.06); color: #1a1a18; }

/* 折叠/展开 */
.kp-collapse-toggle {
  width: 22px; height: 22px; border: none; border-radius: 4px;
  background: transparent; color: #b0ad9d; cursor: pointer; display: flex;
  align-items: center; justify-content: center; flex-shrink: 0; margin-left: auto;
  transition: all 0.12s;
}
.kp-collapse-toggle:hover { background: rgba(0,0,0,0.05); color: #6b6963; }

/* 侧栏收起 */
.kp-sidebar { transition: width 0.2s; position: relative; }
.kp-sidebar.collapsed { width: 26px; min-width: 26px; }
.kp-sidebar-inner { display: flex; flex-direction: column; height: 100%; }
.kp-sidebar-strip {
  width: 100%; height: 100%; display: flex; align-items: flex-start; justify-content: center;
  padding-top: 14px; cursor: pointer; color: #b0ad9d; transition: color 0.12s;
}
.kp-sidebar-strip:hover { color: #3d3591; background: rgba(0,0,0,0.02); }

/* 中间列表收起 */
.kp-list { transition: width 0.2s; position: relative; }
.kp-list.collapsed { width: 26px; min-width: 26px; }
.kp-list-inner { display: flex; flex-direction: column; height: 100%; }
.kp-list-strip {
  width: 100%; height: 100%; display: flex; align-items: flex-start; justify-content: center;
  padding-top: 14px; cursor: pointer; color: #b0ad9d; transition: color 0.12s;
}
.kp-list-strip:hover { color: #3d3591; background: rgba(0,0,0,0.02); }

@media (max-width: 767px) {
  .kp-page { flex-direction: column; }
  .kp-sidebar { width: 100%; max-height: 40vh; overflow-y: auto; border-right: none; border-bottom: 1px solid rgba(0,0,0,0.06); }
  .kp-detail { width: 100%; }
  .kp-list { width: 100%; max-height: 40vh; }
}
</style>
