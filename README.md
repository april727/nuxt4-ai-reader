# Nuxt 4 AI Reader

基于 **Nuxt 4** 和 **DeepSeek API** 的 AI 阅读分析工具。支持上传 PDF 和 TXT 文件、网页解析、AI 智能分析、标注对话等功能。

## 功能

- **📚 书架管理** — 文件夹分类、卡片式展示、拖拽上传
- **📖 AI 阅读** — 左右分栏，左侧原文、右侧 AI 分析面板
- **🎨 智能标注** — 选中文本即可标记单词/短语/句子，AI 自动解释
- **💬 对话分析** — 针对文章内容与 AI 对话，支持流式输出
- **📝 翻译引擎** — 选中即译，浮动展示
- **📂 复习本** — 生词、短语、句子集中复习，按书过滤
- **🔗 网页解析** — 输入 URL 自动提取正文（基于 Mozilla Readability）
- **📄 PDF 解析** — 基于 pdf.js，支持文本提取

## 技术栈

| 技术 | 用途 |
|------|------|
| **Nuxt 4** | 全栈框架（app/ srcDir 架构） |
| **SQLite (sql.js)** | 本地数据存储 |
| **DeepSeek API** | AI 分析、翻译、对话 |
| **pdfjs-dist** | PDF 解析与文本提取 |
| **Mozilla Readability** | 网页正文提取 |
| **marked** | Markdown 渲染 |

## 快速开始

### 前置要求

- **Node.js** >= 18.20
- **DeepSeek API Key**（[点此申请](https://platform.deepseek.com/)）

### 安装与运行

#### 方式一：一键脚本（Windows）

双击运行 `setup.bat`，或命令行执行：

```bash
setup.bat
```

#### 方式二：手动安装

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
# 复制并编辑 .env 文件，填入你的 DeepSeek API Key
```

```env
DEEPSEEK_API_KEY=sk-your-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

```bash
# 3. 启动开发服务器
npm run dev
```

浏览器访问 **http://localhost:3000**

## 使用指南

### 导入内容

支持三种方式导入阅读材料：

1. **拖拽上传** — 将 PDF/TXT 文件拖入书架页面
2. **粘贴文本** — 点击"粘贴"按钮，粘贴文章内容
3. **网页链接** — 输入 URL，自动抓取正文

### 阅读与分析

点击书籍卡片进入阅读页：

- **左侧** — 原文展示，段落编号，点击跳转
- **右侧** — AI 分析面板（包含摘要、核心观点、精彩段落等）
- **选中文本** → 弹出颜色按钮：
  - 🟡 黄色 → 单词标记
  - 🟢 绿色 → 短语标记
  - 🟦 青色 → 句子标记
  - 🟣 紫色 → 翻译
  - 🔵 蓝色 → 播放 AI 分析

### 复习本

标记过的内容自动收录到复习本，可按书籍过滤查看。

## 项目结构

```
nuxt4-ai-reader/
├── app/
│   ├── composables/         # 组合函数
│   ├── pages/               # 页面路由
│   │   ├── index.vue        # 书架首页
│   │   ├── read/[id].vue    # 阅读页
│   │   └── reviews.vue      # 复习本
│   └── assets/styles/       # 样式文件
├── server/
│   ├── api/                 # API 接口
│   │   ├── deepseek/*       # DeepSeek AI 相关
│   │   ├── text/*           # 文本 CRUD
│   │   ├── folder/*         # 文件夹管理
│   │   └── ...              # 其他接口
│   ├── data/                # 数据库与上传文件
│   │   ├── reader.db        # SQLite 数据库
│   │   ├── backups/         # 数据库备份（保留 10 份）
│   │   └── uploads/         # 上传的 PDF 原件
│   └── utils/               # 服务端工具函数
├── shared/types/            # 类型定义
├── nuxt.config.ts           # Nuxt 配置
└── setup.bat                # Windows 安装脚本
```

## 配置

修改 `DEEPSEEK_MODEL` 即可切换模型：

```env
# 非思考模式（快速）
DEEPSEEK_MODEL=deepseek-v4-flash

# 推理模式（深度思考）
DEEPSEEK_MODEL=deepseek-v4-pro
```

## 构建与部署

```bash
# 构建生产版本
npm run build

# 预览生产版本
npm run preview

# 静态生成
npm run generate
```

## 许可证

MIT
