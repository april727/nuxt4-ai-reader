# AI Reader · 智能阅读器

基于 Nuxt 4 + DeepSeek 的智能阅读分析工具。支持 PDF/Markdown/网页/视频导入，AI 分析文章结构，段落级交互（翻译、解释、标记、问答），视频字幕学习，复习本生词管理。

---

## 功能概览

### 内容导入
- 📄 **PDF** — PyMuPDF 提取文字，智能段落结构保留
- 🔗 **网页** — 输入 URL，Mozilla Readability 自动抓取正文
- 📝 **粘贴** — 直接粘贴纯文本
- 🎬 **视频/音频** — YouTube / Bilibili / 本地文件，字幕自动提取或上传

### 阅读与分析
- 🤖 **AI 分析** — DeepSeek 生成标题、摘要、背景、要点
- ✂️ **智能分段** — 默认保留原文段落，手动触发 AI 重新分段
- 💬 **段落问答** — 浮动 QA 框，逐段对话，历史持久化
- 🌐 **翻译 / 解释** — 选中文本或段落级触发
- 🏷️ **三色标记** — 词（黄）/ 短语（绿）/ 句子（青），AI 自动解释 + 音标
- 🖼️ **段落图片** — 上传或粘贴图片挂到段落，浮动预览 / 拖拽 / 缩放 / 折叠
- 🔍 **书内搜索** — Ctrl+F 全文搜索
- 📍 **阅读位置** — 点击段编号标记，一键跳回

### 视频学习
- 🎧 **三模式切换** — 视频 / 纯听（音频条 + 大字幕） / 听写（笔记 + 字幕）
- 🔄 **AB 循环** — 单句精听
- 📝 **精听练习** — 标记句子反复练习

### 书架与复习
- 📂 **文件夹管理** — 创建 / 删除 / 拖拽移动
- 🎨 **卡片展示** — 类型图标 + 视频缩略图 + 进度状态
- 📚 **复习本** — 标记汇总，按书筛选，发音播放

---

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Nuxt 4 (Vue 3 + TypeScript) |
| 存储 | SQLite (sql.js)，含自动备份 |
| AI | DeepSeek API (v4-flash / v4-pro) |
| PDF 提取 | PyMuPDF (fitz) + pdfjs-dist 兜底 |
| 视频字幕 | yt-dlp + SRT/VTT 解析 |
| 网页提取 | @mozilla/readability |
| Markdown | markdown-it |
| 字体 | Lora（正文）/ DM Mono（代码）/ DM Sans（UI） |

---

## 快速开始

### 环境要求

- Node.js ≥ 18
- Yarn 或 npm
- DeepSeek API Key

### 安装

```bash
git clone <repo-url>
cd nuxt4-ai-reader
yarn install          # 或 npm install
```

### 配置

创建 `.env`：

```env
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
DEEPSEEK_MODEL=deepseek-v4-flash
```

### 启动

```bash
yarn dev              # http://localhost:3000
```

### PDF 文字提取（可选）

```bash
pip install pymupdf --break-system-packages
```

不装此依赖时会自动回退到 pdfjs-dist 提取。

---

## 项目结构

```
nuxt4-ai-reader/
├── app/                         # Nuxt 4 应用源码
│   ├── pages/
│   │   ├── index.vue            # 书架首页
│   │   ├── read/[id].vue        # 阅读页
│   │   ├── watch/[id].vue       # 视频播放页
│   │   └── reviews.vue          # 复习本
│   ├── components/              # 组件
│   │   ├── ArticlePanel.vue     # 段落渲染 + 工具条
│   │   ├── AnalysisPanel.vue    # AI 分析面板 + QA
│   │   ├── MarkPopup.vue        # 可拖拽标记弹框
│   │   ├── FloatingImage.vue    # 浮动图片预览
│   │   ├── AudioControlBar.vue  # 音频控制条
│   │   ├── VideoPlayer.vue      # 视频播放器
│   │   ├── BookCard.vue         # 书架卡片
│   │   └── ...
│   ├── composables/             # useArticle / useDeepSeek / useTextStream
│   └── assets/                  # 全局样式
├── server/                      # Nitro 服务端
│   ├── api/
│   │   ├── text/                # 文本 CRUD
│   │   ├── deepseek/            # AI 分析 / 分段 / 流式
│   │   ├── file/                # 文件服务 + 上传
│   │   ├── video/               # 视频元数据 / 字幕
│   │   └── paragraph/           # 段落图片管理
│   ├── utils/                   # db / pdf-parse / subtitle
│   └── data/                    # DB + 备份 + 上传文件
├── shared/types/                # 共享类型
├── nuxt.config.ts
└── README.md
```

## 开发笔记

- Nuxt 4 别名 `~` / `@` 指向 `app/`，根目录用 `~~` / `@@`
- `useAsyncData` 的 `data` / `error` 默认值改为 `undefined`
- 阅读页不会自动触发 AI 分段——保留原文段落，手动点击「AI 分析」或「重新分段」
- 图片支持上传和 Ctrl+V 粘贴，段落级折叠/尺寸调节
- 视频 iframe mouseup 事件泄漏已用 `e.buttons` 检测修复
- 幻灯片分隔线拖拽同上修复

## 许可证

MIT
