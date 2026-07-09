# nuxt4-ai-reader 项目架构文档

## 技术栈

- **前端**: Nuxt 4 + Vue 3 + TypeScript
- **数据库**: SQLite (sql.js 本地 + Turso 云端双模式)
- **AI**: DeepSeek API（文章分析、分段、单词/短语/句子标注、对话）
- **样式**: 纯 CSS（DM Sans / DM Mono / Lora 字体，暖米色系，强调色 #3d3591）

---

## 目录结构

```
nuxt4-ai-reader-turso/
├── app/                         # Nuxt 4 源码目录
│   ├── app.vue                  # 根组件
│   ├── assets/styles/main.css   # 全局样式 (860行)
│   ├── public/                  # 静态资源 (icon.png, icon+title.png, title.png)
│   ├── pages/                   # 页面组件
│   ├── components/              # 组件 (25+)
│   └── composables/             # 组合式函数 (8)
├── server/                      # Nitro 服务端
│   ├── api/                     # API 路由 (90+)
│   ├── utils/                   # 工具类 (12)
│   ├── data/                    # 运行时数据（sqlite db、文件存储）
│   └── scripts/                 # 迁移/转换脚本 (3)
├── prompt/                      # AI 提示词模板 (8)
├── nuxt.config.ts
├── package.json
├── README.md
├── DATA_FLOW.md                 # 数据流文档
└── nuxt4-cheatsheet.md          # Nuxt 4 迁移参考
```

---

## 数据库 Schema（7 张表）

### texts — 核心内容表
| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | UUID |
| title | TEXT | 标题 |
| text | TEXT | 原始文本 |
| source | TEXT | 来源类型 (file/url/youtube) |
| folder | TEXT | 所属文件夹 ID |
| excerpt | TEXT | 摘要 |
| filePath | TEXT | 本地文件路径 |
| analysis | JSON | AI 分析结果（标题、摘要、背景、关键要点） |
| segments | JSON | 分段数据（段落数组） |
| explanations | JSON | 段落解析缓存 `{segmentIndex: markdown}` |
| marks | JSON | 标记数组（单词/短语/句子） |
| readingPosition | JSON | 阅读进度 |
| paragraphChats | JSON | 按段落的 AI 对话历史 |
| paragraphNotes | JSON | 段落笔记 |
| videoMeta | JSON | 视频元数据 |
| videoSubtitles | JSON | 字幕数据 |
| subtitlePractice | JSON | 跟读练习记录 |
| completedAt | TEXT | 完成阅读时间 |
| createdAt / updatedAt | TEXT | 时间戳 |

### folders — 文件夹
| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | |
| name | TEXT | |
| parent | TEXT | 父文件夹 ID |
| isPrivate | INTEGER | |
| passwordHash | TEXT | |
| createdAt | TEXT | |

### stats — 阅读统计（每个 text 一条）
| 列 | 类型 | 说明 |
|----|------|------|
| textId | TEXT PK | |
| readCount | INTEGER | |
| lastReadAt | TEXT | |
| markCount | INTEGER | |

### wordbooks — 单词本
| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 默认三个: `wb_default`, `wb_phrases`, `wb_sentences` |
| name | TEXT | |
| isDefault | INTEGER | |
| sortOrder | INTEGER | |
| createdAt | TEXT | |

### words — 单词 / 短语 / 句子
| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | |
| bookId | TEXT FK → wordbooks.id | |
| word | TEXT | 词条文本（lemma 优先，原文兜底） |
| phonetic | TEXT | 音标 |
| meaning | TEXT | 释义 |
| example | TEXT | 例句 |
| note | TEXT | 笔记（lemma ≠ 原文时自动补"原文: xxx"） |
| phase | TEXT | 学习阶段 |
| learnCorrect / learnTotal / learnWrong | INTEGER | SM-2 算法参数 |
| ease / interval / repetitions / nextReview | REAL/INTEGER | SM-2 算法参数 |
| source | TEXT FK → texts.id | 来源文本 |
| pos | TEXT | 词性 (n./v./adj./adv. 等) |
| createdAt / updatedAt | TEXT | |

### knowledge_points — 知识要点
| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | |
| content | TEXT | 内容 |
| note | TEXT | 笔记 |
| sourceId | TEXT | 来源文本 ID |
| sourceTitle | TEXT | 来源标题 |
| sourceType | TEXT | |
| sourceContext | TEXT | 上下文 |
| customGroup | TEXT | 自定义分组 |
| tags | TEXT | |
| chatHistory | JSON | AI 对话历史 |
| sortOrder | INTEGER | |
| createdAt / updatedAt | TEXT | |

### daily_insights — 每日 AI 洞察缓存
| 列 | 类型 | 说明 |
|----|------|------|
| date | TEXT PK | 日期 (YYYY-MM-DD) |
| content | TEXT | AI 生成的日报内容 |
| createdAt | TEXT | |

---

## 数据流

```
用户导入文本
  → texts 表 (text, title, source, folder, filePath)
  → AI 分析 (analyzeArticle) → texts.analysis (JSON)
  → AI 分段 (segmentArticle) → texts.segments (JSON)

用户阅读时划词标记
  → texts.marks 追加标记 (JSON 数组)
  → AI 查词 (markExplain) → 标记的 detail 字段 (音标、词性、释义、用法)
  → syncMarksToWordbooks → words 表新增单词
  → stats.markCount +1

用户删除标记
  → texts.marks 移除标记
  → cleanupDeletedMarks → words 表删除对应单词
  → 复习本/每日页面自动同步 (直接读 texts.marks)

闪卡学习
  → words 表更新 SM-2 参数 (ease, interval, repetitions, nextReview)

数据库同步 (sql.js ↔ Turso)
  → 写入后 30s 自动推送到 Turso (基于 updatedAt 增量)
  → 每 60s 自动从 Turso 拉取 (基于 updatedAt 增量)
```

---

## 核心设计原则

1. **texts.marks 是唯一数据源** — 复习本、每日统计、每日洞察都直接读取 texts.marks，不维护中间拷贝
2. **words 表是派生表** — 单词本数据由 marks 自动同步（新增/删除均自动），不从单词本反向影响文本标记
3. **增量同步** — sql.js ↔ Turso 基于 `updatedAt` 时间戳做增量，每行独立比较，不冲突
4. **JSON 列** — analysis、segments、explanations、marks、paragraphChats 均以 JSON 字符串存储在 texts 表中，灵活扩展

---

## 页面路由

| 路径 | 组件 | 功能 |
|------|------|------|
| `/` | index.vue | 文库主页（侧边栏 + 卡片网格） |
| `/read/[id]` | read/[id].vue | 阅读页（分段渲染、标注、AI对话） |
| `/watch/[id]` | watch/[id].vue | 视频播放（字幕同步、跟读练习） |
| `/reviews` | reviews.vue | 复习本（标记网格、导出） |
| `/knowledge` | knowledge.vue | 知识库（来源分组、AI对话） |
| `/words/daily` | words/daily.vue | 每日学习日历 |
| `/words/daily/[date]` | words/daily/[date].vue | 每日详情 |
| `/words/analysis` | words/analysis.vue | 词汇分析仪表盘 |
| `/wordbooks` | wordbooks/index.vue | 单词本列表 |
| `/wordbooks/[id]` | wordbooks/[id]/index.vue | 单词本详情 |
| `/wordbooks/[id]/cards` | wordbooks/[id]/cards.vue | 闪卡学习 |
| `/wordbooks/book/[textId]` | wordbooks/book/[textId]/index.vue | 按书查看生词 |

---

## Composables

| 文件 | 功能 |
|------|------|
| useArticle.ts | 全局文章状态（段落、标记、AI分析、对话缓存） |
| useDeepSeek.ts | DeepSeek API 封装（分析、分段、查词、对话、流式） |
| useTextStream.ts | requestAnimationFrame 打字动画 |
| useLocalStorage.ts | 类型安全的 localStorage 响应式封装 |
| useTheme.ts | 深色模式切换 |
| useIsMobile.ts | 768px 移动端检测 |
| usePronunciation.ts | 音频播放 + speechSynthesis 发音 |
| useVideoThumbnail.ts | Canvas 视频缩略图截取 |

---

## API 路由分组

| 分组 | 数量 | 说明 |
|------|------|------|
| deepseek/ | 9 | AI 调用（分析、分段、查词、标记、对话、流式、翻译、总结） |
| text/ | ~20 | 文本 CRUD、段落操作、搜索、统计、笔记 |
| video/ | ~15 | 视频元数据、字幕、播放列表、跟读练习 |
| wordbooks/ | ~15 | 单词本 CRUD、单词增删改查、同步、导入导出 |
| words/ | ~10 | 词汇统计、每日数据、AI聚类、词性补充、去重 |
| knowledge/ | ~8 | 知识要点 CRUD、对话、分组、同步 |
| folder/ | ~8 | 文件夹 CRUD、隐私、解锁 |
| reviews/ | 1 | 复习列表（直接读 texts.marks） |
| upload/ | 1 | 图片上传 |
| file/ | 1 | 静态文件服务 |
| sync/ | 1 | 手动触发 Turso 同步 |

---

## Server Utils

| 文件 | 功能 |
|------|------|
| db.ts | 主数据库模块（sql.js + Turso 双模式，自动同步，JSON备份） |
| sync-from-turso.ts | Turso → sql.js 增量拉取 |
| sync-turso.ts | sql.js → Turso 增量推送 |
| storage.ts | 文件路径管理（files/{folderId}/{contentId}/ 层级） |
| lock.ts | 内存互斥锁 |
| srt.ts | SRT/VTT 字幕解析 + YouTube 去重 |
| subtitle.ts | 字幕辅助函数 |
| batch-state.ts | 批量任务状态跟踪 |
| folderCache.ts | 文件夹列表内存缓存 (30s TTL) |
