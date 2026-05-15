# 视频/音频听力学习功能 — 完整实施方案

> 设计于 2026-05-14，基于现有 Nuxt 4 AI Reader 项目

---

## 一、整体架构

```
现有系统                         新增系统
┌──────────┐                  ┌──────────────────┐
│  书架     │                  │  视频上传入口      │
│  /        │ ─── 融合 ─────→ │  (书籍卡片同层)    │
└────┬─────┘                  └────────┬─────────┘
     │                                 │
     ▼                                 ▼
┌──────────┐                  ┌──────────────────┐
│ 阅读页    │  桥接跳转         │ 播放页            │
│ /read/id ├────────────────→ │ /watch/id         │
│ (字幕学习)│  ←───────────── │ (视频+字幕+精听)   │
└──────────┘  "回到播放"      └──────────────────┘
     │                                 │
     │ 共享组件                          │ 独立组件
     │ (MarkPopup/TranslateCard/        │ (VideoPlayer/
     │  AnalysisPanel/QA Area)          │  SubtitleList)
     │                                 │
     └──────────┬──────────────────────┘
                ▼
         ┌──────────────┐
         │  复习本 /reviews │
         │  (生词/短语好句    │
         │    + 精听句子)    │
         └──────────────┘
```

### 核心理念

- **两份视图，一份数据**：视频的字幕文本存入 `texts` 表的 `text` 字段，AI 分析流程（analyze/explain/chat/mark）零改动
- **播放模式** (`/watch/[id]`)：专注泛听 + 精听 + 跟读
- **学习模式** (`/read/[id]`)：复用现有阅读页做阅读理解 + 标记 + 问答
- **书架统一**：视频卡片和书籍卡片混排，用不同的 pastel 色区分

---

## 二、数据模型变更

### shared/types/index.ts — 新增类型

```typescript
// ====== 新增：字幕句 ======
export interface SubtitleCue {
  id: string        // 'cue_0', 'cue_1'...
  index: number
  start: number     // 开始时间（秒）
  end: number       // 结束时间（秒）
  text: string      // 字幕文本
  words?: Array<{   // 可选：单词级时间戳（用于逐词高亮）
    word: string
    start: number
    end: number
  }>
}

// ====== 新增：精听练习记录 ======
export interface SubtitlePractice {
  cueId: string
  repeatCount: number
  mastered: boolean
  lastPracticed: string  // ISO date
  notes?: string
}

// ====== 扩展 Paragraph：字幕段落 ======
// 复用现有 Paragraph 接口，外部扩展映射即可
// Paragraph { id, index, text } —— 字幕学习时，段落 = 字幕句

// ====== 新增：视频元数据 ======
export interface VideoMeta {
  url: string            // 视频/音频 URL（本地路径或外部链接）
  type: 'youtube' | 'bilibili' | 'video_file' | 'audio_file'
  duration: number       // 总时长（秒）
  thumbnail?: string     // 缩略图 URL
  subtitles: SubtitleCue[]
  practice?: Record<string, SubtitlePractice>  // keyed by cueId
}
```

### 数据库 — texts 表扩展

已有字段规划（无需迁移）：

| 字段 | 用途 | 现有/新增 |
|------|------|-----------|
| `id` | 主键 | 现有 |
| `title` | 标题 | 现有 |
| `text` | 字幕纯文本（用于 AI 分析入口） | 现有 |
| `source` | `'youtube'` / `'video_file'` / `'audio_file'` | 现有（扩展值） |
| `folder` | 文件夹 | 现有 |
| `excerpt` | 简介 | 现有 |
| `filePath` | 本地视频文件路径 | 现有 |
| `analysis` | JSON：AI 全文分析 | 现有 |
| `segments` | JSON：段落列表（复用作字幕句列表，增加 start/end） | 现有（需扩展） |
| `explanations` | JSON：段落解释缓存 | 现有 |
| `marks` | JSON：标记列表 | 现有 |
| `readingPosition` | JSON：阅读位置（播放进度） | 现有（扩展为含 videoTime） |
| `paragraphChats` | JSON：问答历史 | 现有 |
| `videoMeta` | **新增字段** -> JSON：视频元数据（url/type/duration/thumbnail） | 新增 |
| `videoSubtitles` | **新增字段** -> JSON：字幕完整时间轴数据 (SubtitleCue[]) | 新增 |
| `subtitlePractice` | **新增字段** -> JSON：精听练习记录 | 新增 |
| `createdAt` | 创建时间 | 现有 |
| `updatedAt` | 更新时间 | 现有 |

> `videoMeta` + `videoSubtitles` + `subtitlePractice` 是 JSON 文本字段，通过 SQLite `ALTER TABLE ADD COLUMN` 添加。

### DB 迁移（server/utils/db.ts）

在 `createTables()` 中追加：

```typescript
try { db.run('ALTER TABLE texts ADD COLUMN videoMeta TEXT DEFAULT \'\'') } catch {}
try { db.run('ALTER TABLE texts ADD COLUMN videoSubtitles TEXT DEFAULT \'\'') } catch {}
try { db.run('ALTER TABLE texts ADD COLUMN subtitlePractice TEXT DEFAULT \'\'') } catch {}
```

---

## 三、新增 API 端点

### 3.1 `POST /api/video/save` — 保存视频+字幕（核心新增）

```
Request:
{
  title: string
  url: string
  type: 'youtube' | 'bilibili' | 'video_file' | 'audio_file'
  subtitles: SubtitleCue[]
  text: string         // 字幕纯文本（从 subtitles 拼接）
  duration: number
  folder?: string
  filePath?: string
  thumbnail?: string
}

Response: { id: string, existed?: boolean }
```

逻辑：
1. 检查 `text` 前 300 字符去重（复用现有 text/save 的去重逻辑）
2. 写入 `texts` 表：`text`（纯文本）、`source`、`videoMeta`、`videoSubtitles` 等
3. 若 `text` 超过一定长度（>500 字符），自动调用 `deepseek/analyze` 做全文分析
4. 返回新 ID

### 3.2 `POST /api/video/subtitle` — 提取字幕（从 URL）

```
Request: { url: string, type: 'youtube' | 'bilibili' }

Response: {
  title: string
  subtitles: SubtitleCue[]
  text: string
  duration: number
  thumbnail?: string
}
```

实现方式：
- **YouTube**：调用 `https://youtubetranscript.com/api/...` 或 `youtubei.js` 提取字幕
- **Bilibili**：调用 Bilibili API 获取 CC 字幕
- 服务端 NPM 包候选：`youtube-transcript`、`ytdl-core`、`bilibili-api`

### 3.3 `POST /api/video/subtitle/upload` — 上传 SRT/VTT 字幕文件

```
Request: FormData { file: .srt / .vtt, videoUrl?: string }

Response: {
  subtitles: SubtitleCue[]
  text: string
  duration: number
}
```

服务端解析 SRT/VTT 格式，转为 `SubtitleCue[]`。

### 3.4 `PATCH /api/video/practice` — 更新精听练习状态

```
Request: { id: string, cueId: string, practice: Partial<SubtitlePractice> }
Response: { success: true }
```

更新 `subtitlePractice` JSON 字段中对应 `cueId` 的记录。

### 3.5 `GET /api/video/[id]` — 获取视频详情（含字幕）

```
Response: {
  id, title, source, videoMeta, videoSubtitles, 
  analysis, segments, marks, subtitlePractice,
  createdAt
}
```

专为 `/watch/[id]` 页面优化，减少传输量（不含全文 text）。

### 3.6 扩展 `POST /api/file/upload-video` — 上传视频/音频文件

```
Request: FormData { file: .mp4 / .webm / .mp3 }
Response: { filePath: string, url: string, duration?: number }
```

视频文件存入 `server/data/uploads/videos/`。文件类型白名单：mp4, webm, ogg, mp3, wav, m4a。

---

## 四、页面设计

### 4.1 书架页改造 (`app/pages/index.vue`)

#### UI 变化

```
┌──────────────────────────────────────────────┐
│  书架                                         │
│  ┌─文件夹列表──┐  [文本] [视频] [全部]  [上传] [网址] │
│  │  默认文件夹   │                              │
│  │  TED Talks   │  ┌────┐ ┌────┐ ┌────┐      │
│  │  播客        │  │书本 │ │视频 │ │书本 │      │
│  │              │  │卡片 │ │卡片 │ │卡片 │      │
│  │              │  └────┘ └────┘ └────┘      │
│  └──────────────┘                              │
└──────────────────────────────────────────────┘
```

- **新增 Tab 导航**：`[文本] [视频] [全部]`（在"复习本"按钮左侧）
- **上传按钮**：点击展开下拉菜单 "上传文件 / 导入视频 / 网址"
- **导入视频弹窗**：支持粘贴 YouTube/B站链接、上传视频文件、上传 SRT 文件

#### 交互逻辑

```
点击"导入视频"→ 弹窗
  ├─ Tab"从链接导入" -> 输入 URL -> 调用 /api/video/subtitle 提取
  ├─ Tab"上传视频"   -> 选择 mp4/webm -> 上传到 server/data/uploads/videos/
  │                    -> 用户需自行提供 SRT 或后续 Whisper 转写
  └─ Tab"上传字幕"   -> 选择 .srt/.vtt -> 解析字幕 -> 关联视频 URL(可选)
```

#### BookCard 适配

- 新增 `video` pastel 色（靛蓝/青蓝色系）：`--thumb-video: linear-gradient(135deg, #a5b4fc, #818cf8)` 
- 识别 `source === 'youtube' | 'video_file' | 'audio_file'`，显示 🎬 图标
- 卡片底部显示视频时长 `"12:35"`
- 点击卡片->导航到 `/watch/[id]` 而非 `/read/[id]`

### 4.2 播放页 (`app/pages/watch/[id].vue`) — 全新页面

#### 完整 UI 布局

```
┌─────────────────────────────────────────────────────┐
│  ← 书架            视频标题           [📖 学习模式]  │  ← TopBar
├──────────────────────────┬──────────────────────────┤
│                          │  字幕 + 精听              │
│  ┌────────────────────┐  │                          │
│  │                     │  │  00:12  Hello, and      │
│  │  视频/音频播放器     │  │  welcome to today's    │
│  │                     │  │  lesson.      [⭐] [🔁] │  ← 当前
│  │   ▶ ⏸               │  │                          │
│  │  ──●────────────    │  │  00:15  In this          │
│  │                     │  │  lesson we'll cover      │
│  └────────────────────┘  │  three main topics. [⭐]  │
│                          │                          │
│  速度: 0.75× 1× 1.5× 2× │  00:18  First, let's      │
│                          │  talk about the... [⭐]   │
│                          │                          │
│                          │  ─── 精听列表 ───        │
│                          │  [⭐ 已保存 3 句]         │
│                          │  00:15 In this lesson... │
│                          │  [🔁 循环] [✓ 掌握]     │
│                          │                          │
├──────────────────────────┴──────────────────────────┤
│  状态栏: "精听 3 句待掌握"                          │
└─────────────────────────────────────────────────────┘
```

#### 区域功能详解

**左侧 — 播放器区域：**
- `<video>` 或 `<audio>` 元素，根据 `source` 类型选择
- 音频模式显示简约封面图（提取视频第一帧或默认图标）
- 播放器下方控制栏：
  - 播放/暂停 ▶ ⏸
  - 进度条（点击跳转）
  - 时间显示 `00:12 / 12:35`
  - 倍速按钮组：0.75× / 1× / 1.25× / 1.5× / 2×
  - 音量滑块
  - 全屏按钮（仅视频模式）

**右侧 — 字幕区域：**
- 字幕按时间轴垂直排列，每条包含时间戳 + 文本
- **当前播放句**高亮（`background: #edeafd`，左侧靛蓝边框 `#3d3591`）
- 自动滚动：当前句超出可视区域时自动滚动到居中位置
- 每条字幕右侧两个操作按钮：
  - ⭐ **保存到精听**（切换状态，已保存变为 ★ 实心）
  - 🔁 **单句循环**（激活后点击字幕自动 A-B 循环）
- **点击字幕**行为：
  1. 视频跳转到 `subtitle.start`
  2. 若 🔁 循环模式已激活 → 自动在 `subtitle.start` 到 `subtitle.end` 间循环
  3. 若未激活循环 → 播完当前句后继续正常播放

**精听列表（字幕区底部）：**
- 折叠面板，显示所有已 ⭐ 保存的字幕
- 每项显示：时间戳 + 文本摘要 + 重复次数 + 掌握状态
- 操作：🔁 循环 / ✓ 标记掌握 / 移除
- 按 `mastered` 状态分组，未掌握的在前面

**顶部栏：**
- 左边：← 书架（回到书架页）
- 中间：视频标题
- 右侧：📖 学习模式按钮（跳转到 `/read/[id]?from=watch`）

#### 组件拆分

```
/pages/watch/[id].vue          ← 页面容器，数据加载
  ├── WatchTopbar.vue           ← 顶部导航栏
  ├── VideoPlayer.vue           ← 视频/音频播放器
  ├── SubtitleList.vue          ← 字幕列表 + 时间同步
  │     ├── SubtitleCueItem.vue ← 单条字幕（时间戳+文本+操作按钮）
  │     └── PracticeList.vue    ← 精听练习列表
  └── WatchStatusBar.vue        ← 底部状态栏
```

#### 核心交互实现要点

**时间同步（`SubtitleList` → `VideoPlayer`）：**
```typescript
// VideoPlayer 播放时，每隔 100ms 发出当前时间
watch(currentTime, (time) => {
  // 查找当前时间对应的字幕索引
  const idx = subtitles.findIndex(c => time >= c.start && time < c.end)
  if (idx !== currentCueIndex) {
    currentCueIndex = idx
    scrollToCue(idx)  // 自动滚动
  }
})

// 点击字幕 -> 跳转
function jumpToCue(cue: SubtitleCue) {
  videoRef.value.currentTime = cue.start
  if (loopMode) startLoop(cue) // 启动 A-B 循环
}
```

**单句循环：**
```typescript
let loopTimer: number | null = null

function startLoop(cue: SubtitleCue) {
  videoRef.value.currentTime = cue.start
  videoRef.value.play()
  
  function checkLoop() {
    if (videoRef.value.currentTime >= cue.end) {
      videoRef.value.currentTime = cue.start
    }
    loopTimer = requestAnimationFrame(checkLoop)
  }
  loopTimer = requestAnimationFrame(checkLoop)
}

function stopLoop() {
  if (loopTimer) cancelAnimationFrame(loopTimer)
}
```

**视频进度保存：**
```typescript
// 每 5 秒保存一次播放进度
watch(currentTime, (time) => {
  if (time > 0 && time % 5 < 0.5) {
    saveProgress(time)
  }
})

// 页面加载时恢复
onMounted(() => {
  const pos = readingPosition.value
  if (pos?.videoTime) {
    videoRef.value.currentTime = pos.videoTime
  }
})
```

### 4.3 学习页适配 (`app/pages/read/[id].vue`)

#### 改动点

```
┌──────────────────────────────────────────┐
│  ← 书架  视频标题          ▶回到播放      │  ← 顶部增加"回到播放"
├──────────────────┬───────────────────────┤
│  [00:12] Hello   │  理解┃笔记┃生词       │
│  and welcome to  │                       │
│  today's...      │  整体翻译 / 解析       │
│  [▶播放] [💬] [📋]│                       │
│                  │  ┌───────────┐        │
│  [00:15] In this │  │ 提问...    │        │
│  lesson we'll... │  └───────────┘        │
│  [▶播放] [💬] [📋]│                       │
│                  │                       │
└──────────────────┴───────────────────────┘
```

**具体改动：**

1. **顶部栏**：若 `source` 是视频类型，显示"▶ 回到播放"按钮，跳转到 `/watch/[id]`
2. **段落编号**：若 `source` 视频类型且 `segments` 包含 `start` 时间戳，将数字序号改为 `[00:12]` 格式
3. **段内工具条**：增加"▶ 播放本句"按钮（调用 `/watch/[id]?jump={paraId}`）
4. 其余所有功能**完全不变**（标记、问答、笔记、生词Tab、MarkPopup、TranslateCard）

#### 学习模式跳转逻辑

```typescript
// /watch/[id] -> /read/[id]
navigateTo(`/read/${id}?from=watch`)

// /read/[id] -> /watch/[id]
navigateTo(`/watch/${id}?from=read&time=${currentTime}`)

// 从播放页跳来时，恢复阅读位置
onMounted(() => {
  if (route.query.from === 'watch' && route.query.time) {
    // 高亮对应字幕句所在段落
  }
})
```

### 4.4 复习本适配 (`app/pages/reviews.vue`)

- 生词、短语、好句标记系统不变——它们已经从 `marks` 字段读取
- 精听练习单独不放在复习本，保留在 `/watch/[id]` 的右侧底部

---

## 五、字幕提取方案

### 5.1 YouTube 字幕提取

```
// 可选方案（按推荐顺序）：
1. youtube-transcript API (youtubetranscript.com)
   GET https://youtubetranscript.com/?v=VIDEO_ID&lang=en
   → 返回 JSON [{text, start, duration}]

2. youtubei.js (NPM 包，无 API key 需求)
   import { Innertube } from 'youtubei.js'
   const video = await yt.getInfo(VIDEO_ID)
   // 获取字幕轨道

3. youtube-dl-exec 调用 yt-dlp 提取字幕
```

### 5.2 Bilibili 字幕提取

```
1. 通过 bilibili API 获取视频信息 + CC 字幕
   https://api.bilibili.com/x/web-interface/view?bvid=BV...
   https://api.bilibili.com/x/player/v2?cid=...&aid=...

2. bilibili-api (NPM 包)
   import { videoInfo } from 'bilibili-api'
```

### 5.3 SRT/VTT 字幕文件解析

服务端实现 SRT 解析器：

```typescript
function parseSRT(content: string): SubtitleCue[] {
  // SRT 格式：
  // 1
  // 00:00:12,500 --> 00:00:14,000
  // Hello, welcome!
  //
  // 2
  // 00:00:15,000 --> 00:00:18,200
  // In this lesson...
  
  const blocks = content.trim().split(/\n\n+/)
  return blocks.map((block, idx) => {
    const lines = block.trim().split('\n')
    const timeMatch = lines[1].match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
    )
    if (!timeMatch) return null
    const start = toSeconds(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4])
    const end = toSeconds(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8])
    const text = lines.slice(2).join(' ').trim()
    return { id: `cue_${idx}`, index: idx, start, end, text }
  }).filter(Boolean) as SubtitleCue[]
}
```

VTT 格式类似，时间分隔符为 `-->`，时间格式为 `HH:MM:SS.mmm`。

### 5.4 语音转字幕（Whisper 集成 — 远期）

```
1. 本地方案：whisper.cpp 或 OpenAI Whisper（需 GPU）
   → 上传视频文件后，服务端调用 whisper 生成字幕
   → 存入 videoSubtitles，text 由字幕拼接生成
   
2. API 方案：DeepSeek 或 OpenAI 的 audio/transcriptions
   → 但需要音频转文字模型，成本较高

3. 推荐：在 Phase 1-3 先支持"用户自行提供字幕"，Phase 4 再集成 Whisper
```

---

## 六、共享组件清单

| 组件 | 复用位置 | 改动 |
|------|---------|------|
| `BookCard.vue` | 书架页 | 增加 video 类型识别 + 靛蓝 pastel + 时长显示 |
| `FolderSidebar.vue` | 书架页 | 不变 |
| `MarkPopup.vue` | 学习页 | 不变 |
| `TranslateCard.vue` | 学习页 | 不变 |
| `MarkdownRenderer.vue` | 学习页 | 不变 |
| `AnalysisPanel.vue` | 学习页 | 不变 |
| `ArticlePanel.vue` | 学习页 | 可复用部分（段内工具条逻辑） |

## 新增组件清单

| 组件 | 所在页面 | 说明 |
|------|---------|------|
| `VideoPlayer.vue` | /watch/[id] | 封装 `<video>`/`<audio>`，含倍速/进度/全屏 |
| `SubtitleList.vue` | /watch/[id] | 字幕列表 + 时间同步 + 自动滚动 |
| `SubtitleCueItem.vue` | /watch/[id] | 单条字幕：时间戳 + 文本 + ⭐ 🔁 按钮 |
| `PracticeList.vue` | /watch/[id] | 精听练习折叠面板 |
| `WatchTopbar.vue` | /watch/[id] | 播放页顶部导航（可复用 reader-topbar 样式） |
| `WatchStatusBar.vue` | /watch/[id] | 底部状态栏 |
| `VideoImportModal.vue` | 书架页 | 视频导入弹窗（三 Tab） |
| `SRTParser.ts` | 服务端 utils | SRT/VTT 解析工具函数 |

---

## 七、实施步骤（编程先后顺序）

### Phase 1：基础设施 + 数据层（预估：半天）

```
Step 1: 扩展 shared/types/index.ts
  - 新增 SubtitleCue, SubtitlePractice, VideoMeta 类型
  - 导出新类型

Step 2: DB 迁移
  - db.ts 的 createTables() 增加 ALTER TABLE 兼容（videoMeta, videoSubtitles, subtitlePractice）
  - 重启应用后自动生效

Step 3: 服务端工具函数
  - 创建 server/utils/srt.ts：parseSRT(), parseVTT() 工具函数
  - 创建 server/utils/subtitle.ts：字幕拼接 text、时间格式化等
```

### Phase 2：视频导入 + API（预估：1 天）

```
Step 4: 新增 API — POST /api/video/save
  - 保存视频元数据 + 字幕到数据库
  - 判断去重，自动触发 deepseek/analyze

Step 5: 新增 API — POST /api/video/subtitle
  - 接收 YouTube/B站 URL
  - 调用对应服务提取字幕（先用 mock 数据，后续集成真实 API）
  - 返回 subtitle 列表 + text

Step 6: 新增 API — POST /api/video/subtitle/upload
  - 接收 SRT/VTT 文件上传
  - 服务端解析
  - 返回 subtitle 列表 + text

Step 7: 新增 API — POST /api/file/upload-video
  - 视频/音频文件上传
  - 存入 server/data/uploads/videos/
  - 返回 filePath 和 url

Step 8: 新增 API — GET /api/video/[id]
  - 返回视频详情（含字幕、元数据、练习记录）

Step 9: 新增 API — PATCH /api/video/practice
  - 更新精听练习状态
```

### Phase 3：书架页改造（预估：0.5 天）

```
Step 10: BookCard.vue 适配
  - 新增 video/audio 类型识别（靛蓝 pastel + 🎬 图标）
  - 显示视频时长
  - 点击跳转 /watch/[id]

Step 11: 书架页顶栏增加过滤 Tab
  - [文本] [视频] [全部] 三个按钮（在"复习本"左侧）
  - 点击过滤，调用 /api/text/list 传 source_filter 参数

Step 12: VideoImportModal.vue
  - 视频导入弹窗组件（三 Tab）
  - "链接导入"：输入 URL → 调用 /api/video/subtitle → 预览字幕 → 确认保存
  - "上传视频"：选择文件 → 调用 /api/file/upload-video → 用户提供字幕
  - "上传字幕"：选择 SRT/VTT → 解析 → 关联视频 → 确认保存

Step 13: 书架页集成导入流程
  - "导入视频"按钮 + 弹窗显示
  - 导入成功后刷新列表
```

### Phase 4：播放页面（预估：1.5 天）— 核心开发

```
Step 14: /pages/watch/[id].vue 主页面
  - 页面数据加载（调用 /api/video/[id]）
  - 基础骨架布局

Step 15: VideoPlayer.vue 组件
  - 封装 <video> / <audio>
  - 播放/暂停/进度条/时间显示
  - 倍速控制按钮组
  - 全屏（仅视频）
  - 暴露 currentTime、play()、pause()、seek() 方法
  - 音频模式（无画面时显示简约封面）

Step 16: SubtitleList.vue 组件
  - 渲染字幕列表
  - 接收 currentTime prop，高亮当前句
  - IntersectionObserver 自动滚动
  - 发出 @cue-click(cue) 事件

Step 17: SubtitleCueItem.vue 组件
  - 单条字幕渲染（时间戳 + 文本）
  - ⭐ 保存按钮（toggle）
  - 🔁 循环按钮（toggle）
  - active 状态样式

Step 18: 点击字幕 → 视频跳转 + A-B 循环
  - VideoPlayer 接收 jumpTo(cue, loop?) 方法
  - 实现 requestAnimationFrame 循环逻辑
  - 点击字幕跳转 + 自动播放
  - 🔁 激活时循环播放

Step 19: PracticeList.vue 组件
  - 折叠面板，显示所有已保存字幕
  - 分组：未掌握/已掌握
  - 操作：🔁循环 / ✓标记掌握 / 移除

Step 20: 精听状态持久化
  - PATCH /api/video/practice 联动
  - 页面加载时恢复练习记录

Step 21: 播放进度保存/恢复
  - 每 5 秒保存 currentTime 到 readingPosition.videoTime
  - 页面加载恢复进度

Step 22: WatchTopbar.vue（或直接写在页面）
  - ← 书架回到 / （记住 activeFolder）
  - 📖 学习模式 → /read/[id]?from=watch

Step 23: WatchStatusBar.vue（或统合到底部）
  - 当前字幕索引 / 总字幕数
  - 精听统计
```

### Phase 5：学习页适配（预估：0.5 天）

```
Step 24: /read/[id] 顶部栏增加"▶ 回到播放"按钮
  - 判断条件：texts.source 为视频类型
  - 按钮样式：与 back-btn 一致，右侧对齐

Step 25: 段落编号改为时间戳
  - 若 segments 有 start 字段，将数字序号替换为 [MM:SS] 格式
  - CSS 调整：时间戳宽度稍宽（50px vs 22px）

Step 26: 段内工具条增加"▶ 播放本句"按钮
  - 点击 → 导航到 /watch/[id]?jump={paraId}
  - 或使用 iframe/新 tab（推荐导航跳转）
```

### Phase 6：边缘功能 + 打磨（预估：0.5 天）

```
Step 27: /reviews 过滤增加视频来源
  - 筛选下拉选择 "全部书籍" 时包含视频

Step 28: 书架页文件夹计数
  - /api/text/list?folder=X 排除或包含视频

Step 29: 字幕对齐校验
  - 导入 SRT 时检查重叠/缺口
  - 非英语字幕检测

Step 30: 性能优化
  - 长视频（大量字幕）虚拟滚动
  - 视频文件流式加载
```

### Phase 7：进阶功能（远期）

```
Step 31: YouTube 字幕真实 API 集成
Step 32: Bilibili 字幕 API 集成
Step 33: Whisper 语音转字幕（上传视频后自动生成）
Step 34: 跟读录音对比
Step 35: 生词本关联视频跳转（marks 增加 cueId 时间戳）
```

---

## 八、UI 设计规范（延续现有风格）

### 配色扩展

```css
/* 现有暖白系 + 紫色强调 */
--watch-bg: #f7f6f3;
--player-bg: #1a1a18;        /* 播放器深色背景，与暖白形成对比 */
--subtitle-active-bg: #edeafd;
--subtitle-active-border: #3d3591;
--accent-blue: #3d3591;       /* 已有，复用 */
--accent-green: #10b981;      /* 精听已掌握 */
--accent-amber: #f59e0b;      /* 精听未掌握/待复习 */
--pastel-video: linear-gradient(135deg, #a5b4fc, #818cf8);  /* 靛蓝 */
```

### 设计要点

1. **播放器深色底**：与阅读页暖白形成鲜明对比，暗示"观看模式"
2. **字幕区域暖白延续**：保持一致
3. **当前字幕句**：左侧靛蓝边框 + 淡紫背景，与段落 active 状态一致
4. **操作按钮 ⭐ 🔁**：使用图标 + hover 变色（accent 色），无文字标签减少视觉噪音
5. **精听列表**：折叠设计，默认收起不干扰字幕浏览
6. **倍速按钮**：胶囊式按钮组，当前选中 accent 色填充

### 字体

```
UTCSS 字体系列：与现有一致
DM Sans → 按钮/标签/时间戳
DM Mono → 时间码 (00:12:05)
Lora    → 字幕文本（与正文一致）
```

---

## 九、关键文件修改清单

### 修改文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `shared/types/index.ts` | 修改 | 新增 SubtitleCue, SubtitlePractice, VideoMeta |
| `server/utils/db.ts` | 修改 | createTables 增加 ALTER TABLE 兼容新字段 |
| `app/pages/index.vue` | 修改 | 增加 Tab 过滤 + 视频导入弹窗集成 |
| `app/components/BookCard.vue` | 修改 | 增加 video 类型展示 |
| `app/pages/read/[id].vue` | 修改 | 顶部按钮 + 时间戳显示 + ▶ 播放按钮 |
| `app/pages/reviews.vue` | 修改 | 增加视频来源过滤 |
| `nuxt.config.ts` | 可能修改 | 如果使用额外 NPM 包需要加 optimizeDeps |
| `.env` | 修改 | 如果集成 YouTube API key 等 |

### 新增文件

| 文件 | 说明 |
|------|------|
| `server/utils/srt.ts` | SRT/VTT 解析工具 |
| `server/utils/subtitle.ts` | 字幕通用工具 |
| `server/api/video/save.post.ts` | 视频保存 API |
| `server/api/video/subtitle/index.post.ts` | 字幕提取 API |
| `server/api/video/subtitle/upload.post.ts` | SRT 上传 API |
| `server/api/video/[id].get.ts` | 视频详情 API |
| `server/api/video/practice.patch.ts` | 精听练习更新 API |
| `server/api/file/upload-video.post.ts` | 视频文件上传 API |
| `app/pages/watch/[id].vue` | 播放页面 |
| `app/components/VideoPlayer.vue` | 视频播放器组件 |
| `app/components/SubtitleList.vue` | 字幕列表组件 |
| `app/components/SubtitleCueItem.vue` | 单条字幕组件 |
| `app/components/PracticeList.vue` | 精听练习列表组件 |
| `app/components/VideoImportModal.vue` | 视频导入弹窗组件 |
| `app/components/WatchTopbar.vue` | 播放页顶部栏 |
| `app/components/WatchStatusBar.vue` | 播放页状态栏 |

---

## 十、可能用到的 NPM 包

```
# 字幕提取（可选，按需安装）
youtube-transcript     # YouTube 字幕提取（无 API key）
youtubei.js            # YouTube 数据 API（备选）
bilibili-api           # Bilibili API（如果支持 B 站）

# 视频/音频处理（Phase 7 远期）
whisper-node           # 调用 Whisper 进行语音转文字
fluent-ffmpeg           # 视频格式转换/缩略图提取
```

---

## 十一、风险与注意事项

1. **YouTube 字幕 API 可靠性**：非官方 API 可能被限流或变更，需要 fallback 方案（允许用户手动上传 SRT）
2. **视频存储空间**：用户上传的视频文件可能很大，建议限制文件大小（初始 200MB）并定期清理
3. **跨域问题**：外部视频 URL（YouTube）需要使用 `<iframe>` 嵌入而非直接 `<video>`，字幕同步方式不同
4. **浏览器兼容性**：`<video>` 对各种编码的支持不同，建议提示用户使用 mp4 (H.264)
5. **音频模式**：当 `source` 为 `audio_file` 时，VideoPlayer 需隐藏画面区域，显示简约波形或封面
6. **SSR 兼容**：`<video>`/`<audio>` 相关代码需包裹 `onMounted` 或 `import.meta.client`

---

## 十二、测试要点

```
1. 字幕解析正确性（SRT 时间格式、编码 UTF-8/GBK）
2. 视频播放 + 字幕时间同步偏差 < 200ms
3. 点击字幕跳转准确性
4. A-B 循环边界（start == end 时防止死循环）
5. 精听持久化（刷新后练习记录保留）
6. 播放进度恢复（关闭页面后重新打开跳转到上次时间）
7. 书架过滤切换流畅性
8. 从播放页→学习页→播放页双向跳转状态保持
9. 大字幕文件（> 1000 条）渲染性能
10. 音频模式切换正确性
```
