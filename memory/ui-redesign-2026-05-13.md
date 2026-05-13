---
name: ui-redesign
description: 2026-05-13 书架首页 + 阅读页 UI 重设计
type: project
---

两轮升级完成：

**第一轮（书架首页）：**
- 暖白配色：侧边栏 `#f0efe9` / 主内容 `#ffffff` / 底色 `#f7f6f3`
- DM Sans (UI) + DM Mono (等宽) 字体
- 强调紫色 `#3d3591`（替换 #6366f1）
- 卡片 pastel 色块（PDF 粉橙 / 网页薄荷绿 / 文本淡紫）
- 工具栏 outline 风格，仅「粘贴文本」紫色实心
- 搜索栏内联可见

**第二轮（阅读页）：**
- 新增 Lora 衬线正文字体
- 顶栏简化：back 按钮 + 标题居中 + 进度圆点 + PDF/位置图标按钮
- 布局改为 grid 1fr + 340px 右侧面板
- 右侧面板改为 Tab 式（理解 / 笔记 / 生词）
- 段落编号用 DM Mono 等宽字体
- 正文用 Lora 衬线 15px/1.82 行高
- 激活段落紫色淡底 `#edeafd`，编号变紫色实心
- 聊天气泡式 UI（用户紫色 / AI 白色卡片）
- 保留全部现有功能：AI 流式分析、标记系统、浮动翻译、PDF 查看
- 去掉暗色模式

**后续可改进：**
- 段落编辑功能（startEdit 目前是 placeholder）
- ArticlePanel / AnalysisPanel 组件已不活跃，可清理
- useTheme composable 不再使用，可清理
