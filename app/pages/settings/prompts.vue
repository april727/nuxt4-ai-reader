<template>
  <div class="pm-page">
    <PageHeader title="Prompt 管理" active="settings" back-to="/" back-label="书架">
      <template #actions>
        <button class="pm-icon-btn" @click="load" :disabled="loading" title="刷新（重新读取本地，清空云端检查结果）">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>
        </button>
      </template>
    </PageHeader>

    <div class="pm-body">
      <!-- 说明 / 状态 -->
      <div class="pm-note" :class="{ 'is-warn': !data.configured }">
        <template v-if="!data.configured">
          云端 Prompt 未配置（缺少 SUPABASE_URL / SUPABASE_KEY），只能看到本地内容。
        </template>
        <template v-else>
          打开页面只读本地，不访问云端。点某条的「预览」或「获取云端」才<strong>单独</strong>向云端请求那一条；下面两个批量按钮会一次性读取云端。
        </template>
      </div>

      <!-- 汇总 + 批量操作 -->
      <div class="pm-summary">
        <div class="pm-stats">
          <span>共 {{ data.count }} 条</span>
          <span class="pm-dot">·</span>
          <span>本地覆盖 {{ data.overrideCount }}</span>
          <span class="pm-dot">·</span>
          <span v-if="!checkedCount">云端未检查</span>
          <span v-else :class="{ 'pm-hot': changedCount > 0 }">
            已检查 {{ checkedCount }} · 云端有更新 {{ changedCount }}
          </span>
        </div>
        <div class="pm-batch">
          <button
            class="pm-btn pm-btn-ghost"
            :disabled="busy || !data.configured"
            @click="applyMode('changed')"
          >拉取有更新的</button>
          <button
            class="pm-btn pm-btn-primary"
            :disabled="busy || !data.configured"
            @click="applyMode('all')"
          >全部获取</button>
        </div>
      </div>

      <div class="pm-file">本地覆盖文件：<code>{{ data.file }}</code></div>

      <div v-if="loading && !data.items.length" class="pm-loading">加载中…</div>

      <!-- 列表 -->
      <div class="pm-list">
        <div
          v-for="it in sortedItems"
          :key="it.key"
          class="pm-item"
          :class="{ 'is-changed': st(it.key).changed }"
        >
          <div class="pm-item-main">
            <div class="pm-item-title">
              {{ it.label }}
              <span class="pm-key">{{ it.key }}</span>
              <span v-if="it.managerKey !== it.key" class="pm-key pm-key-cloud">↔ {{ it.managerKey }}</span>
            </div>
            <div class="pm-item-meta">
              <span class="pm-tag" :class="it.source === 'override' ? 'pm-tag-local' : 'pm-tag-default'">
                {{ it.source === 'override' ? '本地覆盖' : it.source === 'default' ? '常量默认' : '缺失' }}
              </span>
              <span v-if="!st(it.key).checked && !st(it.key).loading" class="pm-tag pm-tag-mute">云端未检查</span>
              <span v-else-if="st(it.key).loading" class="pm-tag pm-tag-mute">查询中…</span>
              <span v-else-if="st(it.key).error" class="pm-tag pm-tag-warn" :title="st(it.key).error">云端读取失败</span>
              <span v-else-if="!st(it.key).cloudAvailable" class="pm-tag pm-tag-mute">云端无此 key</span>
              <span v-else-if="st(it.key).changed" class="pm-tag pm-tag-changed">云端有更新</span>
              <span v-else class="pm-tag pm-tag-ok">与云端一致</span>
              <span class="pm-len">本地 {{ it.localLength }} 字</span>
              <span v-if="st(it.key).checked && st(it.key).cloudAvailable" class="pm-len">云端 {{ st(it.key).cloudLength }} 字</span>
            </div>
          </div>

          <div class="pm-item-actions">
            <button class="pm-btn pm-btn-ghost" @click="openPreview(it)" :disabled="busy">预览</button>
            <button
              class="pm-btn pm-btn-primary"
              :disabled="busy || !data.configured"
              title="单独拉取这一条的云端内容并写入本地"
              @click="applyKeys([it.key])"
            >获取云端</button>
            <button
              class="pm-btn pm-btn-danger"
              :disabled="busy || !it.hasOverride"
              :title="it.hasOverride ? '' : '本地没有覆盖，已是默认'"
              @click="resetKey(it)"
            >恢复默认</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 预览弹窗：本地 vs 云端（打开时才单独拉取这一条的云端内容） -->
    <Teleport to="body">
      <div v-if="preview" class="pm-modal-backdrop" @click.self="closePreview">
        <div class="pm-modal">
          <div class="pm-modal-head">
            <div class="pm-modal-title">
              预览 · {{ preview.label }}
              <span class="pm-key">{{ preview.key }}</span>
            </div>
            <button class="pm-modal-close" @click="closePreview" aria-label="关闭">×</button>
          </div>

          <div v-if="previewLoading" class="pm-modal-state">正在单独拉取云端内容…</div>
          <div v-else-if="previewError" class="pm-modal-state is-error">云端读取失败：{{ previewError }}</div>
          <div v-else class="pm-modal-body">
            <div class="pm-pane">
              <div class="pm-pane-head">
                本地当前（{{ preview.source === 'override' ? '本地覆盖' : '常量默认' }}）
                <span class="pm-pane-len">{{ preview.localLength }} 字</span>
              </div>
              <pre class="pm-pane-pre">{{ preview.local || '（空）' }}</pre>
            </div>
            <div class="pm-pane pm-pane-cloud">
              <div class="pm-pane-head">
                云端
                <span class="pm-pane-len">{{ preview.cloudLength }} 字</span>
              </div>
              <pre class="pm-pane-pre">{{ preview.cloud || '（云端没有内容）' }}</pre>
            </div>
          </div>

          <div class="pm-modal-foot">
            <span class="pm-modal-hint">
              <template v-if="previewLoading">查询中…</template>
              <template v-else-if="previewError">无法对比。</template>
              <template v-else-if="preview.changed">两边内容不同，替换后本地生效。</template>
              <template v-else>两边内容一致，替换不会有变化。</template>
            </span>
            <div class="pm-modal-actions">
              <button class="pm-btn pm-btn-ghost" @click="closePreview">取消</button>
              <button
                class="pm-btn pm-btn-primary"
                :disabled="busy || previewLoading || !!previewError || !preview.cloudAvailable"
                @click="applyKeys([preview.key])"
              >写入本地</button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <Transition name="pm-toast">
      <div v-if="toast" class="pm-toast">{{ toast }}</div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
useHead({ title: 'Prompt 管理' })

type Source = 'override' | 'default' | 'missing'

interface LocalItem {
  key: string
  managerKey: string
  label: string
  source: Source
  hasOverride: boolean
  localLength: number
  local: string
}
interface LocalData {
  configured: boolean
  file: string
  count: number
  overrideCount: number
  items: LocalItem[]
}
/** 单条云端详情（/api/prompt/cloud/item 的返回） */
interface ItemDetail extends LocalItem {
  cloudAvailable: boolean
  changed: boolean
  cloudLength: number
  version: string | number | null
  cloud: string
}
/** 每条的云端检查状态（前端缓存，初始都没有） */
interface CloudStatus {
  checked: boolean
  loading: boolean
  error: string
  cloudAvailable: boolean
  changed: boolean
  version: string | number | null
  cloudLength: number
  cloud: string
}

const data = ref<LocalData>({ configured: false, file: '', count: 0, overrideCount: 0, items: [] })
const cloud = ref<Record<string, CloudStatus>>({})
const loading = ref(false)
const busy = ref(false)
const preview = ref<ItemDetail | null>(null)
const previewLoading = ref(false)
const previewError = ref('')
const toast = ref('')

function emptyStatus(): CloudStatus {
  return { checked: false, loading: false, error: '', cloudAvailable: false, changed: false, version: null, cloudLength: 0, cloud: '' }
}
/** 取某条的云端状态（没有则给一个空状态，模板里不用写非空断言） */
function st(key: string): CloudStatus {
  return cloud.value[key] || emptyStatus()
}
function setStatus(key: string, s: CloudStatus) {
  cloud.value = { ...cloud.value, [key]: s }
}

const checkedCount = computed(() => Object.values(cloud.value).filter((s) => s.checked && !s.loading).length)
const changedCount = computed(() => Object.values(cloud.value).filter((s) => s.changed).length)

/** 有更新的排前面，其次本地覆盖的，再按原顺序 */
const sortedItems = computed(() => {
  const rank = (it: LocalItem) => (st(it.key).changed ? 0 : it.hasOverride ? 1 : 2)
  return [...data.value.items].sort((a, b) => rank(a) - rank(b))
})

async function load() {
  loading.value = true
  try {
    data.value = await $fetch<LocalData>('/api/prompt/cloud/preview')
    cloud.value = {} // 重新加载后云端检查结果全部失效
  } catch (e: any) {
    toast.value = '读取失败：' + (e?.message || '')
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** 单独拉取某一条的云端内容（只读，不写入），并缓存检查结果 */
async function fetchItem(key: string): Promise<ItemDetail> {
  setStatus(key, { ...st(key), loading: true, error: '' })
  try {
    const it = await $fetch<ItemDetail>('/api/prompt/cloud/item', { params: { key } })
    setStatus(key, {
      checked: true, loading: false, error: '',
      cloudAvailable: it.cloudAvailable, changed: it.changed,
      version: it.version, cloudLength: it.cloudLength, cloud: it.cloud,
    })
    return it
  } catch (e: any) {
    setStatus(key, { ...st(key), checked: false, loading: false, error: e?.data?.message || e?.message || String(e) })
    throw e
  }
}

function openPreview(it: LocalItem) {
  preview.value = { ...it, cloudAvailable: false, changed: false, cloudLength: 0, version: null, cloud: '' }
  previewError.value = ''
  previewLoading.value = true
  fetchItem(it.key)
    .then((detail) => { preview.value = detail })
    .catch((e: any) => { previewError.value = e?.data?.message || e?.message || String(e) })
    .finally(() => { previewLoading.value = false })
}
function closePreview() {
  preview.value = null
}

function flash(msg: string) {
  toast.value = msg
  setTimeout(() => { if (toast.value === msg) toast.value = '' }, 2600)
}

/** 单独拉取指定 key 并写入本地覆盖文件 */
async function applyKeys(keys: string[]) {
  if (!keys.length) return
  busy.value = true
  try {
    const res = await $fetch<{ applied: string[]; skipped: Array<{ key: string; reason: string }> }>(
      '/api/prompt/cloud/apply',
      { method: 'POST', body: { keys } },
    )
    preview.value = null
    await load()
    if (res.applied.length) flash(`已写入本地 ${res.applied.length} 条`)
    else if (res.skipped.length) flash(res.skipped[0].reason || '云端没有可写入的内容')
  } catch (e: any) {
    flash('写入失败：' + (e?.data?.message || e?.message || ''))
  } finally {
    busy.value = false
  }
}

/** 批量：changed=只写有更新的；all=全部写入 */
async function applyMode(mode: 'changed' | 'all') {
  const tip = mode === 'changed'
    ? '检查云端全部 Prompt，把有更新的写入本地覆盖文件？'
    : '把云端全部 Prompt 写入本地覆盖文件？本地当前内容会被云端内容替换。'
  if (!confirm(tip)) return
  busy.value = true
  try {
    const res = await $fetch<{ applied: string[]; skipped: Array<{ key: string; reason: string }> }>(
      '/api/prompt/cloud/apply',
      { method: 'POST', body: { mode } },
    )
    await load()
    if (res.applied.length) flash(`已写入本地 ${res.applied.length} 条`)
    else flash(mode === 'changed' ? '没有需要更新的 Prompt' : '云端没有可写入的内容')
  } catch (e: any) {
    flash('操作失败：' + (e?.data?.message || e?.message || ''))
  } finally {
    busy.value = false
  }
}

async function resetKey(it: LocalItem) {
  if (!confirm(`恢复「${it.label}」为默认？将删除本地覆盖，改用 prompts.ts 里的常量。`)) return
  busy.value = true
  try {
    await $fetch('/api/prompt/local/reset', { method: 'POST', body: { keys: [it.key] } })
    await load()
    flash(`「${it.label}」已恢复默认`)
  } catch (e: any) {
    flash('恢复失败：' + (e?.data?.message || e?.message || ''))
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.pm-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f7f6f3;
}
.pm-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 8px;
  background: #fff;
  color: #6b6963;
  cursor: pointer;
  transition: all 0.12s;
}
.pm-icon-btn:hover:not(:disabled) { color: #3d3591; border-color: rgba(61,53,145,0.25); }
.pm-icon-btn:disabled { opacity: 0.5; cursor: default; }

.pm-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 28px 60px;
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
}

.pm-note {
  font-size: 12.5px;
  line-height: 1.6;
  color: #6b6963;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.07);
  border-left: 3px solid #3d3591;
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 14px;
}
.pm-note.is-warn {
  border-left-color: #d97706;
  color: #92400e;
  background: #fffbeb;
}

.pm-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.pm-stats {
  font-size: 12.5px;
  color: #6b6963;
}
.pm-dot { margin: 0 6px; color: #c4c1ba; }
.pm-hot { color: #b45309; font-weight: 600; }
.pm-batch { display: flex; gap: 8px; }

.pm-file {
  font-size: 11.5px;
  color: #a09e97;
  margin-bottom: 16px;
}
.pm-file code {
  font-family: 'DM Mono', monospace;
  background: #f0efe9;
  padding: 1px 5px;
  border-radius: 4px;
}

.pm-loading { text-align: center; color: #a09e97; padding: 40px 0; font-size: 14px; }

.pm-list { display: flex; flex-direction: column; gap: 10px; }
.pm-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 16px;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.07);
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.pm-item.is-changed { border-color: rgba(217,119,6,0.35); }
.pm-item-main { min-width: 0; }
.pm-item-title {
  font-size: 13.5px;
  color: #1a1a18;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.pm-key {
  font-family: 'DM Mono', monospace;
  font-size: 11px;
  color: #a09e97;
  background: #f0efe9;
  padding: 1px 6px;
  border-radius: 4px;
}
.pm-key-cloud { color: #6b6963; }
.pm-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: 11.5px;
  color: #a09e97;
  flex-wrap: wrap;
}
.pm-tag {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  border: 1px solid transparent;
}
.pm-tag-local { background: #edeafd; color: #3d3591; }
.pm-tag-default { background: #f0efe9; color: #6b6963; }
.pm-tag-mute { background: #f6f5f1; color: #a09e97; }
.pm-tag-changed { background: #fef3c7; color: #b45309; font-weight: 600; }
.pm-tag-ok { background: #ecfdf5; color: #047857; }
.pm-tag-warn { background: #fef2f2; color: #b91c1c; }
.pm-len { font-family: 'DM Mono', monospace; }

.pm-item-actions { display: flex; gap: 8px; flex-shrink: 0; }

.pm-btn {
  padding: 6px 13px;
  border-radius: 8px;
  border: 1px solid rgba(0,0,0,0.1);
  background: #fff;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  color: #6b6963;
  transition: all 0.12s;
  white-space: nowrap;
}
.pm-btn:disabled { opacity: 0.45; cursor: default; }
.pm-btn-primary { color: #3d3591; border-color: rgba(61,53,145,0.25); }
.pm-btn-primary:hover:not(:disabled) { background: #f0eefb; }
.pm-btn-ghost:hover:not(:disabled) { background: #f6f5f1; }
.pm-btn-danger { color: #dc2626; }
.pm-btn-danger:hover:not(:disabled) { background: #fef2f2; border-color: rgba(220,38,38,0.25); }

/* ── 预览弹窗 ── */
.pm-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(20,18,14,0.42);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.pm-modal {
  width: min(1000px, 100%);
  max-height: 86vh;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 18px 50px rgba(0,0,0,0.22);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.pm-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(0,0,0,0.07);
}
.pm-modal-title { font-size: 14px; font-weight: 600; color: #1a1a18; display: flex; align-items: center; gap: 8px; }
.pm-modal-close {
  border: none;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  color: #a09e97;
  cursor: pointer;
  padding: 0 4px;
}
.pm-modal-close:hover { color: #1a1a18; }
.pm-modal-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  font-size: 13px;
  color: #6b6963;
}
.pm-modal-state.is-error { color: #b91c1c; }
.pm-modal-body {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 14px 18px;
  min-height: 0;
}
.pm-pane { display: flex; flex-direction: column; min-height: 0; }
.pm-pane-head {
  font-size: 11.5px;
  color: #6b6963;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pm-pane-len { font-family: 'DM Mono', monospace; color: #a09e97; }
.pm-pane-cloud .pm-pane-head { color: #3d3591; }
.pm-pane-pre {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 12px;
  background: #f8f7f4;
  border: 1px solid rgba(0,0,0,0.07);
  border-radius: 10px;
  font-family: 'DM Mono', monospace;
  font-size: 11.5px;
  line-height: 1.6;
  color: #3a3833;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 56vh;
}
.pm-pane-cloud .pm-pane-pre { background: #f7f6fd; border-color: rgba(61,53,145,0.15); }
.pm-modal-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px;
  border-top: 1px solid rgba(0,0,0,0.07);
}
.pm-modal-hint { font-size: 11.5px; color: #a09e97; }
.pm-modal-actions { display: flex; gap: 8px; }

.pm-toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 3200;
  background: rgba(26,26,24,0.92);
  color: #fff;
  font-size: 12.5px;
  padding: 9px 18px;
  border-radius: 999px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.2);
  pointer-events: none;
}
.pm-toast-enter-active,
.pm-toast-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.pm-toast-enter-from,
.pm-toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

@media (max-width: 720px) {
  .pm-body { padding: 14px 12px 40px; }
  .pm-item { flex-direction: column; align-items: stretch; }
  .pm-item-actions { width: 100%; }
  .pm-item-actions .pm-btn { flex: 1; text-align: center; }
  .pm-modal-body { grid-template-columns: 1fr; }
  .pm-modal { max-height: 92vh; }
}
</style>
