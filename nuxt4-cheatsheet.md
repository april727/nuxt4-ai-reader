# Nuxt 4 完整变更备忘录
> 面向 LLM 编程参考 · 基于官方文档 nuxt.com/blog/v4 及 upgrade guide · 2025年7月15日正式发布

---

## 一、目录结构（最核心变化）

Nuxt 4 默认 `srcDir` 改为 `app/`，完整标准结构如下：

```
project/
├── app/                    ← srcDir，~/ 和 @/ 指向这里（⚠️ Nuxt 3 时指向根目录）
│   ├── assets/
│   ├── components/
│   ├── composables/
│   ├── layouts/
│   ├── middleware/
│   ├── pages/
│   ├── plugins/
│   ├── utils/
│   ├── app.vue
│   ├── app.config.ts
│   └── router.options.ts
├── shared/                 ← app/ 和 server/ 共享代码，#shared 别名
│   ├── types/              ← 自动导入
│   └── utils/              ← 自动导入
├── server/                 ← rootDir 下，不在 app/ 内
├── content/
├── public/
├── modules/
└── nuxt.config.ts
```

### 路径别名对照

| 别名 | 指向 | 说明 |
|---|---|---|
| `~/` `@/` | `app/` | ⚠️ Nuxt 3 时指向根目录，Nuxt 4 改变了 |
| `~~/` `@@/` | 项目根目录 | 跨层访问根目录用这个 |
| `#shared` | `shared/` | 官方自动配置，app 和 server 都能用 |

### 关键规则

- `~/shared/xxx` 是**错误写法**，应使用 `#shared/xxx` 或直接自动导入
- `server/` 保留在根目录，不随 `app/` 移动
- 旧结构完全兼容：Nuxt 会自动检测并保持旧有行为，迁移可渐进进行

---

## 二、shared/ 目录规则

`shared/types/` 和 `shared/utils/` 下的文件**自动导入**，其他位置需手动使用 `#shared` 别名：

```ts
// ✅ 自动导入（来自 shared/utils/ 或 shared/types/）
const result = capitalize('hello')

// ✅ 手动引入（其他路径）
import capitalize from '#shared/capitalize'
import lower from '#shared/formatters/lower'

// ❌ 错误写法
import capitalize from '~/shared/capitalize'  // ~ 指向 app/，找不到
```

---

## 三、数据获取层重大变化

### 3.1 `useAsyncData` / `useFetch` 四项关键变化

#### ① 同 key 共享 ref（Breaking）

多个组件使用同一个 key 时，`data`、`error`、`status`、`pending` 是**同一个**响应式引用。
**以下选项必须在同 key 的所有调用中保持一致**：`deep`、`transform`、`pick`、`default`。

```ts
// ❌ 触发开发警告：同一 key，deep 选项不一致
const { data: users1 } = useAsyncData('users', () => $fetch('/api/users'), { deep: false })
const { data: users2 } = useAsyncData('users', () => $fetch('/api/users'), { deep: true })

// ✅ 允许不一致的选项（不影响数据内容）
const { data: users1 } = useAsyncData('users', () => $fetch('/api/users'), { immediate: true })
const { data: users2 } = useAsyncData('users', () => $fetch('/api/users'), { immediate: false })
```

#### ② getCachedData 增强

现在每次 fetch（包括 watcher 触发和 `refreshNuxtData`）都会调用，并接收 `ctx` 参数说明触发原因：

```ts
type AsyncDataRequestContext = {
  cause: 'initial' | 'refresh:manual' | 'refresh:hook' | 'watch'
}

// 官方默认实现（Nuxt 4）
const getDefaultCachedData = (key, nuxtApp, ctx) =>
  nuxtApp.isHydrating
    ? nuxtApp.payload.data[key]
    : nuxtApp.static.data[key]

// 自定义示例：手动刷新时跳过缓存，其他情况使用缓存
const { data } = await useAsyncData('posts', () => $fetch('/api/posts'), {
  getCachedData(key, nuxtApp, ctx) {
    if (ctx.cause === 'refresh:manual') return undefined  // 强制重新请求
    return nuxtApp.payload.data[key] ?? nuxtApp.static.data[key]
  }
})
```

#### ③ 响应式 key

key 现在支持 `computed ref`、普通 `ref`、getter 函数，key 变化自动重新请求：

```ts
const userId = ref(1)

// ✅ getter 函数作为 key
const { data } = await useAsyncData(
  () => `user-${userId.value}`,
  () => $fetch(`/api/users/${userId.value}`)
)

// key 变化时自动重新请求
userId.value = 2
```

#### ④ 自动内存清理

最后一个使用该数据的组件卸载后，Nuxt 自动清除对应 key 的缓存数据，防止内存泄漏。

---

### 3.2 data 和 error 默认值变化（Breaking）

| | Nuxt 3 | Nuxt 4 |
|---|---|---|
| `data` 初始默认值 | `null` | **`undefined`** |
| `error` 初始默认值 | `null` | **`undefined`** |

```ts
// ❌ Nuxt 3 风格判断（在 Nuxt 4 中可能出错）
if (data.value !== null) { ... }

// ✅ Nuxt 4 正确写法
if (data.value !== undefined) { ... }
if (data.value) { ... }  // 推荐，同时处理 null/undefined
```

---

### 3.3 刷新时旧数据行为变化（Breaking）

| | Nuxt 3 | Nuxt 4 |
|---|---|---|
| 刷新时旧数据 | 保留（stale-while-revalidate） | **立即清除，设为 undefined** |
| `pending` 为 true 时 `data` | 保留旧值 | **`undefined`** |

```vue
<template>
  <!-- ✅ Nuxt 4 必须显式处理 pending 状态 -->
  <div v-if="pending">Loading...</div>
  <div v-else-if="data">
    <h1>{{ data.title }}</h1>
  </div>
</template>

<script setup>
const { data, pending } = await useAsyncData('post', () => $fetch('/api/post'))
</script>
```

如需保留旧数据（兼容 Nuxt 3 行为）：

```ts
const { data: rawData } = await useAsyncData('post', () => $fetch('/api/post'))

const displayData = ref(rawData.value)
watch(rawData, (newData) => {
  if (newData) displayData.value = newData
})
```

---

## 四、TypeScript 项目拆分

Nuxt 4 将 TypeScript 配置拆分为四个独立 tsconfig，根目录只保留一个引用文件：

```json
// tsconfig.json（根目录，只有引用）
{
  "files": [],
  "references": [
    { "path": "./.nuxt/tsconfig.app.json" },
    { "path": "./.nuxt/tsconfig.server.json" },
    { "path": "./.nuxt/tsconfig.shared.json" },
    { "path": "./.nuxt/tsconfig.node.json" }
  ]
}
```

### 关键影响：不同上下文严格隔离

```ts
// ❌ 在 app/ 代码中引用 Node.js 原生模块 → 立即报 TS 错误
import { readFileSync } from 'node:fs'
// Error: Cannot find module 'node:fs' or its corresponding type declarations

// ✅ Node.js 模块只能在 server/ 目录使用
// server/api/data.get.ts
import { readFileSync } from 'node:fs'
export default defineEventHandler(() => { ... })
```

```ts
// ✅ shared/ 中定义跨端共享类型
// shared/types/user.ts
export interface User {
  id: number
  name: string
}

// app/components/UserCard.vue
import type { User } from '#shared/types/user'  // 或自动导入

// server/api/users.get.ts
import type { User } from '#shared/types/user'  // 同样可用
```

---

## 五、组件命名规范统一

文件夹+文件名的组合命名在所有场景下全面统一：

- Nuxt 内部组件注册
- Vue `<KeepAlive include="...">` 字符串匹配
- Vue DevTools 显示名称

```vue
<!-- 文件: app/components/Base/Button.vue -->
<!-- 组件名统一为: BaseButton -->

<!-- ✅ KeepAlive 使用一致的命名 -->
<KeepAlive include="BaseButton">
  <BaseButton />
</KeepAlive>
```

---

## 六、样式内联行为变化

Nuxt 4 **只对 Vue 组件内联样式**，不再对全局 CSS 进行内联处理。

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  features: {
    // 默认行为：只内联 .vue 文件中的样式
    inlineStyles: (id) => id.includes('.vue'),

    // 如需完全关闭内联
    // inlineStyles: false,
  }
})
```

---

## 七、CLI 与开发服务器性能提升

| 改进项 | 说明 |
|---|---|
| 更快冷启动 | 开发服务器启动速度明显加快 |
| Node.js 编译缓存 | 自动复用 v8 compile cache |
| 原生文件监听 | 使用 `fs.watch` API，减少系统资源占用 |
| Socket 通信 | CLI 与 Vite dev server 通过内部 socket 通信，取代网络端口，Windows 上改善尤为明显 |

---

## 八、中间件支持 async/await

```ts
// app/middleware/auth.global.ts
export default defineNuxtRouteMiddleware(async (to, from) => {
  const { isLoggedIn } = await useAuth()  // ✅ 原生支持 async，无需 hack
  if (!isLoggedIn) return navigateTo('/login')
})
```

---

## 九、已废弃 / 移除项

| 项目 | 说明 |
|---|---|
| `window.__NUXT__` | 全局对象已移除 |
| Nuxt 2 兼容层 | `@nuxt/kit` 移除了对 Nuxt 2 的支持（影响模块作者） |
| 路由元数据 | 去重处理，部分路由索引有变化 |
| 目录 index 扫描 | 部分目录内部扫描行为已精简 |
| 实验性功能清理 | 部分 Nuxt 3 实验性功能已被正式移除 |
| `data.value === null` 判断 | `data`/`error` 默认值改为 `undefined` |

### 隐性 Breaking：同名文件 + 目录路由冲突

`[param].vue` 和 `[param]/`（同名目录）同时存在时，子路由可能无法正确注册。

```txt
❌ Nuxt 3 可以，Nuxt 4 有冲突：
pages/
  parent/
    [id].vue              → /parent/:id
    [id]/cards.vue        → /parent/:id/cards  可能不渲染

✅ Nuxt 4 标准做法（嵌套路由）：
pages/
  parent/
    [id].vue              → /parent/:id  父路由（放 <NuxtPage />）
    [id]/
      index.vue           → /parent/:id  子页面
      cards.vue           → /parent/:id/cards  子页面
```

父路由用 `<NuxtPage />` 作为占位符，子页面在 `[id]/` 目录下作为独立文件。遇到 `navigateTo()` 不触发页面切换时，可用 `window.location.href` 强制整页跳转作为兜底。

---

## 十、升级步骤

```bash
# 1. 升级 Node.js 到 >= 18.20（推荐 LTS）

# 2. 升级 Nuxt（--dedupe 同时整理 lockfile）
npx nuxt upgrade --dedupe

# 3. 运行官方自动迁移 codemod（处理大部分机械性变更）
npx codemod@latest nuxt/4/migration-recipe

# 4. 迁移目录结构（可选，不迁移也兼容）
mkdir app
mv assets components composables layouts middleware pages plugins utils app/
mv app.vue app.config.ts error.vue app/
```

---

## 十一、编程黄金规则速查

```
✅ 应用代码放在    app/
✅ 服务端代码放在  server/
✅ 跨端共享类型放在 shared/types/ 或 shared/utils/（自动导入）
✅ shared/ 其他路径用 #shared/xxx 别名引入
✅ 不要在 app/ 中 import Node.js 原生模块（fs, path, crypto 等）
✅ useAsyncData / useFetch 的 data 和 error 默认值是 undefined，不是 null
✅ 相同 key 下 data ref 共享，不同组件禁止用同一 key 配不同 transform/deep/pick
✅ pending=true 时 data 为 undefined，模板中必须显式处理加载态
✅ 中间件支持原生 async/await，无需 hack
✅ getCachedData 第三个参数 ctx.cause 可判断触发原因
✅ 根目录 tsconfig.json 只做 references，不直接配置
✅ ~ 和 @ 别名现在指向 app/，根目录用 ~~ 或 @@
✅ [param].vue 和 [param]/目录不能并行作为独立路由，必须用嵌套路由 + <NuxtPage />
```

---

> **维护说明**：Nuxt 3 将持续获得维护更新直到 2026 年 1 月底，无需急于迁移。
