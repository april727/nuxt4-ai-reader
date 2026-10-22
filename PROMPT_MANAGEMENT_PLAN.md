# Prompt 管理改造方案

## 现状对齐

当前 prompt 分布在两处，对应你比喻里的"便利贴贴满办公室"：

| 位置 | 数量 | 使用方式 |
|------|------|----------|
| `server/utils/prompts.ts` 常量 | 8 个 | `prompt/[name].get.ts` 提供 API；4 个 deepseek 端点 import 后 replace |
| 各 deepseek 端点内联 | ~7 个 | explain、mark、chat、translate、summary、word、clean 各自硬编码 |

数据库（Turso/sql.js）已有 9 张业务表，但 **没有 prompts 表**。项目用 Nuxt 4 + Netlify Functions 部署（serverless），每次请求独立运行。

---

## 改造目标

你想要的三个核心能力：

1. **统一入库** — 所有 prompt 存数据库，一条记录一个 key
2. **后台管理** — `/admin/prompts` 页面可视化编辑
3. **实时生效** — 改完即用，不重启、不部署

---

## 实施分 5 步

### 第 1 步：建表 + 数据迁移

在 `server/utils/db.ts` 新增 `prompts` 表：

```sql
CREATE TABLE IF NOT EXISTS prompts (
  name        TEXT PRIMARY KEY,      -- 唯一标识，如 'explain', 'mark-word'
  content     TEXT NOT NULL,         -- prompt 模板文本（含 {var} 占位符）
  description TEXT DEFAULT '',       -- 中文说明，管理页面展示用
  variables   TEXT DEFAULT '[]',     -- JSON 数组：["articleContext","paragraphText",...]
  category    TEXT DEFAULT 'general',-- 分类：mark / explain / content / podcast / other
  updated_at  TEXT NOT NULL,         -- ISO 时间戳
  created_at  TEXT NOT NULL
);
```

建表后执行一次 seed 脚本，把 `server/utils/prompts.ts` 的 8 个 prompt 和 7 个内联 prompt 统一入库。seed 脚本只跑一次，后续数据以数据库为准。

**同时保留 `server/utils/prompts.ts` 作为兜底。** 数据库不可用时自动回退到常量版本，保证部署安全。

### 第 2 步：Prompt 服务层

新建 `server/utils/promptService.ts`，提供统一接口：

```ts
// 获取单个 prompt（带缓存）
async function getPrompt(name: string): Promise<Prompt | null>

// 获取全部 prompt 列表
async function listPrompts(): Promise<Prompt[]>

// 更新 prompt（管理员用）
async function updatePrompt(name: string, content: string): Promise<void>
```

关键设计点：

**缓存策略。** Netlify Functions 是 serverless，每次请求可能启动新实例。用模块级变量做内存缓存（单实例生命周期内有效），配合时间戳校验：

```
取 prompt 流程：
  getPrompt('explain')
    → 检查内存缓存，命中且未过期(60s) → 直接返回
    → 未命中 → 查数据库
      → 查到 → 更新缓存，返回
      → 查不到 → 回退到 PROMPTS 常量，返回
```

缓存时间设 60 秒，既保证频繁请求不反复查库（标记类 prompt 在同一篇文章阅读时会大量调用），又把"改了没生效"的窗口控制在 1 分钟以内。如果你想要"改了立刻生效"，可以把缓存 TTL 降到 5 秒或加一个手动刷新按钮。

**变量填充。** 从数据库取出 prompt 模板后，用 `fillPrompt(template, vars)` 替换 `{varName}` 占位符。这个逻辑已有（`read/[id].vue` 里 `fillPrompt` 函数），提炼到 service 层复用。

### 第 3 步：改造 API 端点

分两个方向改：

**A. `prompt/[name].get.ts`（被前端调用的接口）**

原来是 `PROMPTS[name]`，改为 `promptService.getPrompt(name)`。对外接口不变，前端无感知。

**B. 各 deepseek 端点（服务端直接用的）**

原来两种写法：
```ts
// 写法一：import 常量
import { PROMPTS } from '../../utils/prompts'
const tpl = PROMPTS['segment'].replace(...)

// 写法二：内联字符串
const systemPrompt = '你是一个翻译助手...'
```

统一改为：
```ts
import { getPrompt, fillPrompt } from '../../../utils/promptService'

const template = await getPrompt('segment')
const filledPrompt = fillPrompt(template, { inputText, sizeRule })
```

同时给 7 个内联 prompt 起好 key：`explain-v2`、`mark-v2`、`chat-system`、`translate`、`summary`、`word-lookup`、`text-clean`（与 `PROMPTS` 里已有的 key 不冲突）。

> 说明：有些内联 prompt 结构特殊（比如 `mark.post.ts` 根据 type 参数动态拼接不同段落），需要把 prompt 拆成三段存入数据库（word/phrase/sentence 各一段），运行时按需组合。

### 第 4 步：后台管理页面

创建两个文件：

**页面：`app/pages/admin/prompts.vue`**

功能清单：
- 左侧分类筛选（mark / explain / content / podcast / other）
- 右侧列表 + 编辑区
- 点击某条 prompt → 展开编辑器（textarea 或简易 Monaco）
- 编辑后点"保存" → 调 `PUT /api/admin/prompts/[name]` → 提示"已生效"
- "重置为默认"按钮 → 从 `PROMPTS` 常量恢复该条原始内容
- "刷新缓存"按钮 → 清空服务端内存缓存，强制下次请求走数据库

不需要登录系统（项目是单人使用的工具），简单起见在 `nuxt.config.ts` 设一个 `ADMIN_KEY` 环境变量，页面加载时校验。或者干脆不做鉴权，因为部署在个人 Netlify 上只有自己能访问。

**API：`server/api/admin/prompts/[name].put.ts`**

```ts
// PUT /api/admin/prompts/explain
// body: { content: "新 prompt 内容..." }
export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  const { content } = await readBody(event)
  await promptService.updatePrompt(name, content)
  promptService.clearCache(name)  // 清除缓存，立即生效
  return { ok: true }
})
```

**API：`server/api/admin/prompts/index.get.ts`**

```ts
// GET /api/admin/prompts — 列表
export default defineEventHandler(async () => {
  return await promptService.listPrompts()
})
```

**API：`server/api/admin/prompts/reset/[name].post.ts`**

```ts
// POST /api/admin/prompts/reset/explain — 重置某条为默认
export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  const defaultContent = PROMPTS[name]  // 从常量取默认值
  await promptService.updatePrompt(name, defaultContent)
  promptService.clearCache(name)
  return { ok: true }
})
```

### 第 5 步：验证 + 收尾

1. 跑一遍现有功能：上传文章 → 分段 → 标注单词/短语/句子 → AI 解读 → 播客提取，确认所有 AI 调用正常工作
2. 进 `/admin/prompts` 改一条 prompt（比如给 `explain` 加一句"用更口语化的中文翻译"），然后回到阅读页点"解读"，确认变化生效
3. 模拟数据库不可用场景（停掉 Turso），确认自动回退到 `PROMPTS` 常量，系统不崩
4. 清理 `server/utils/prompts.ts` 中不再作为主数据源但仍保留为兜底的代码注释，标注"DB 优先，此为 fallback"

---

## 方案总结

| 对比维度 | 改造前 | 改造后 |
|----------|--------|--------|
| prompt 存储 | 代码常量 + 内联字符串 | Turso/sql.js 数据库单表 |
| 修改方式 | 改代码 → git → 部署 | 打开管理页面 → 编辑 → 保存 |
| 生效时间 | 部署完成后（数分钟） | 1 分钟内（缓存刷新后即生效） |
| 管理界面 | 无 | `/admin/prompts` |
| 变量管理 | 散落在各端点 replace 调用里 | `variables` 字段统一记录 |
| 回滚能力 | git revert + 重新部署 | 点"重置为默认"或手动改回 |
| 部署安全 | 不依赖外部状态 | 数据库不可用时自动降级到常量 |

---

## 估计工作量

- 第 1 步（建表 + seed）：30 分钟
- 第 2 步（promptService）：1 小时
- 第 3 步（改造端点）：1.5 小时（端点多，但改动模式一致）
- 第 4 步（管理页面）：2 小时（页面 + 3 个 API）
- 第 5 步（验证）：30 分钟

总计约 5～6 小时，可分两天完成。
