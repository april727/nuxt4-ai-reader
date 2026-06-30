# 当前数据流动全景

## 总体架构

```
┌──────────────────────────────────────────────────────────────┐
│                       浏览器 (Vue 3)                          │
│  pages/index.vue  │  pages/read/[id].vue  │  watch/[id].vue  │
└──────────┬──────────────────────┬───────────────────────────↑─┘
           │ HTTP fetch           │ HTTP fetch                │
           ▼                      ▼                           │
┌──────────────────────────────────────────────────────────────┐
│                    Nuxt 4 / Nitro Server                      │
│                                                              │
│  ┌─────────────────────┐    ┌──────────────────────────────┐ │
│  │  API Routes (79个)   │    │  server/middleware/auth.ts   │ │
│  │  POST/GET/PUT/DELETE │───→│  (密码验证中间件)            │ │
│  └─────────┬───────────┘    └──────────────────────────────┘ │
│            │                                                 │
│            ▼                                                 │
│  ┌──────────────────────────────────────────────────┐       │
│  │              server/utils/                       │       │
│  │                                                  │       │
│  │  db.ts ───── 数据库层 (双模式)                    │       │
│  │  sync-turso.ts ─ sql.js → Turso 增量同步          │       │
│  │  r2.ts ─────── Cloudflare R2 文件存储            │       │
│  │  storage.ts ─── 本地文件路径管理                   │       │
│  │  file-sync.ts ── 本地文件 → R2 自动同步            │       │
│  │  cache.ts ────── 书架数据 10秒缓存                 │       │
│  │  lock.ts ─────── 写入锁                           │       │
│  └──────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────┘
```

---

## 一、读操作流程

### 1.1 书架列表（首页）

```
浏览器 GET /api/text/list?folder=xxx
       │
       ▼
text/list.get.ts
       │
       ├─ cache.ts 检查: 10秒内有缓存? → 直接返回
       │
       └─ queryAll('SELECT ... FROM texts WHERE folder=?')
            │
            ├─ Turso 模式 (USE_TURSO=true)
            │    └─ @libsql/client.execute() ──→ HTTPS ──→ Turso 云端
            │      返回: SQLite over HTTP (libsql 协议)
            │
            └─ sql.js 模式 (USE_TURSO=false)  ←←← 当前本地开发
                 └─ prepare() → bind() → step() → getAsObject()
                    全部在 WASM 内存中操作，无磁盘 I/O
                           │
         ┌─────────────────┘
         ▼
   对每行补充:
     - statsMap (readCount, lastReadAt)
     - videoMeta 解析 (duration, thumbnail)
     - aiSegmented 判断 (segments JSON 解析)
         │
         ▼
   设置 10秒 内存缓存 + HTTP Cache-Control: max-age=15
         │
         ▼
   返回 JSON → 浏览器渲染书架卡片
```

### 1.2 打开文章阅读

```
浏览器 GET /api/text/[id]
       │
       ▼
text/[id].get.ts
       │
       └─ queryOne('SELECT * FROM texts WHERE id=?')
            → 同上，sql.js 内存 / Turso 云端
       │
       ├─ 读取 analysis, segments, explanations, marks 等 JSON 字段
       │   (sql.js/Turso 都存为 TEXT, 应用层 JSON.parse)
       │
       ├─ 如果有 filePath → 通过 /api/file/[path] 读取源文件
       │   (PDF/EPUB 等)
       │
       └─ 返回完整文本数据 → 浏览器渲染阅读器
```

### 1.3 文件/图片读取

```
浏览器 GET /api/file/[encodedPath]
       │
       ▼
file/[...name].get.ts
       │
       ├─ R2 模式 (USE_R2=true):
       │   ├─ r2Head(name) → R2 有文件?
       │   │   ├─ 是: 视频流 → r2GetStream()  (支持 Range 请求)
       │   │   │   图片 → r2SignedUrl() → 302 跳转直连 R2
       │   │   └─ 否: 回退到本地文件系统
       │   └─ 本地回退: resolveFilePath() → readFileSync
       │
       └─ 本地模式 (USE_R2=false):
            └─ resolveFilePath(name)
                ├─ 新格式 "folderId/id/source.ext" → files/...
                ├─ 旧格式 "vid_xxx.mp4" → uploads/
                └─ 再找不到 → 递归搜索 files/ 子目录
                    → 返回文件流 (支持 Range 分片)
```

---

## 二、写操作流程

### 2.1 标记已读 / 更新统计

```
浏览器 POST /api/text/stats  { id, marks? }
       │
       ▼
text/stats.post.ts
       │
       ├─ queryOne('SELECT readCount FROM stats WHERE textId=?')  ← 读
       │
       ├─ runQuery('INSERT OR REPLACE INTO stats ...')             ← 写
       │
       └─ 返回 { ok: true }  → 浏览器更新 UI

                ↓ 这个 runQuery 是关键瓶颈 ↓
```

### 2.2 runQuery 内部（写操作核心路径）

```
runQuery(sql, params)
       │
       ├─ Turso 模式:
       │   └─ db.execute({ sql, args })  ← 一次 HTTPS 请求
       │       Turso 服务器端执行增量 SQL 写入（快）
       │
       └─ sql.js 模式:  ←←← 当前本地开发 (问题的根源)
            │
            ├─ db.run(sql, params)  ← 写入 WASM 内存（快，微秒级）
            │     内存中的 SQLite 引擎执行 UPDATE/INSERT
            │
            └─ saveDbSqljs()  ← 防抖 5 秒
                 │
                 └─ setTimeout(5000ms):
                      ├─ sqljsDb.export()
                      │   将整个 WASM 内存数据库序列化为 Uint8Array
                      │   ⚠️ 数据量越大越慢（几百 KB → 几百 MB）
                      │
                      ├─ 备份: readFileSync(DB_PATH)
                      │   → writeFileSync(backups/reader-{timestamp}.db)
                      │   ⚠️ 完整复制一份
                      │
                      ├─ 清理旧备份（保留最近 10 个）
                      │
                      ├─ writeFileSync(DB_PATH, Buffer.from(data))
                      │   ⚠️ 完整写入磁盘
                      │
                      └─ scheduleSyncToTurso()  ← 防抖 30 秒
                           └─ syncToTurso():
                                ├─ 重新 initSqlJs() + readFileSync(DB_PATH)
                                ├─ 逐表 SELECT 本地全部数据
                                ├─ SELECT Turso 全部数据
                                ├─ 逐行对比 (rowsEqual)
                                └─ INSERT 新增 / UPDATE 变化的行
```

### 2.3 移动文件夹

```
浏览器 POST /api/text/move  { id, folder }
       │
       ▼
text/move.post.ts
       └─ runQuery('UPDATE texts SET folder=? ...')
           → 同上写路径（sql.js 全量导出 or Turso 增量 SQL）
```

### 2.4 保存新文章

```
浏览器 POST /api/text/save  { text, title?, folder? }
       │
       ▼
text/save.post.ts
       ├─ queryAll('SELECT id,title,text FROM texts')  ← 读全部文章去重
       ├─ 文件移动: moveToFinal() ← storage.ts
       └─ runQuery('INSERT INTO texts ...')  ← 写
```

---

## 三、文件上传流程

### 3.1 上传图片

```
浏览器 POST /api/upload/image  (multipart: file + id)
       │
       ▼
upload/image.post.ts
       │
       ├─ readMultipartFormData(event)
       ├─ generate UUID → hash
       ├─ getImagesDir('default', textId)
       ├─ ensureDir() + writeFileSync(磁盘)
       │
       └─ 返回 URL: /api/file/default/{textId}/images/img_{hash}.png

（如果 R2 模式，后台还有一层:）
       └─ file-sync.ts
            └─ queueFileSync(key, localPath)
                 └─ debounce 30秒
                      └─ readFileSync(localPath) → r2Put(key, buf)
                           └─ S3 PutObjectCommand → Cloudflare R2
```

### 3.2 上传视频

```
浏览器 POST /api/file/upload-video  (multipart: file + folderId + textId)
       │
       ▼
file/upload-video.post.ts
       ├─ 临时文件 → moveToFinal() → 存到 files/{folderId}/{textId}/source.mp4
       ├─ 缩略图 → moveThumbToFinal()
       ├─ runQuery('UPDATE texts SET videoMeta=? ...')  ← DB 写
       └─ queueFileSync() → 30s 后上传 R2
```

---

## 四、同步流程：sql.js → Turso

### 4.1 自动同步（每次落盘后 30 秒）

```
saveDbSqljs() 导出到磁盘后
       │
       └─ scheduleSyncToTurso()
            └─ 防抖 30 秒后执行 syncToTurso():
                 │
                 ├─ re-init: new SQL.Database(readFileSync(DB_PATH))
                 │   ⚠️ 重新读取整个数据库文件
                 │
                 ├─ 遍历 7 张表:
                 │   folders, texts, stats, knowledge_points,
                 │   wordbooks, words, daily_insights
                 │
                 ├─ 每张表:
                 │   ├─ SELECT 所有本地行 → Map<pk, row>
                 │   ├─ SELECT 所有 Turso 行 → Map<pk, row>
                 │   ├─ 逐主键对比:
                 │   │   ├─ 本地有 / Turso 无 → INSERT
                 │   │   ├─ 本地有 / Turso 有且不同 → UPDATE
                 │   │   └─ 本地有 / Turso 有且相同 → SKIP
                 │   └─ 批量发送 INSERT/UPDATE SQL
                 │
                 └─ 返回 { totalInserted, totalUpdated }
```

### 4.2 手动同步（用户点击"同步到云端"按钮）

```
浏览器 POST /api/sync/to-turso
       │
       ▼
sync/to-turso.post.ts
       └─ syncToTurso()  ← 同上逻辑

注意: 这是单向同步（本地 → Turso）
      Turso 的修改不会主动拉回本地
```

---

## 五、AI 流程

### 5.1 DeepSeek 对话（流式）

```
浏览器 POST /api/deepseek/chat  { content, textId?, paragraphId? }
       │
       ▼
deepseek/chat.post.ts
       ├─ 加载 prompt 模板: prompt/[name].get.ts
       ├─ 调用 DeepSeek API (流式)
       │   POST https://api.deepseek.com/chat/completions
       │   Headers: Authorization=Bearer $DEEPSEEK_API_KEY
       │   Body: { model: deepseek-v4-flash, stream: true, ... }
       │
       └─ 流式返回 → 浏览器逐步打字输出

其他 AI 端点同样:
  deepseek/explain.post.ts  → 解释选中文本
  deepseek/translate.post.ts → 翻译
  deepseek/analyze.post.ts   → 全篇分析
  deepseek/summary.post.ts   → 总结
  deepseek/mark.post.ts      → 标注
  deepseek/segment.post.ts   → 分段
  ...
```

---

## 六、整体数据流摘要

### 本地开发模式（当前）

```
浏览器 ←→ Nuxt 服务器 ←→ sql.js (WASM 内存)
                │
                ├─ 每次写 → 防抖 5s → 导出整个 DB 到磁盘文件
                ├─ 磁盘备份 (保留 10 份)
                └─ 防抖 30s → 增量同步到 Turso 云端

文件: 浏览器 ←→ Nuxt ←→ 本地磁盘 server/data/files/
       └─ 防抖 30s → R2 云端 (仅备份)
```

### 生产部署模式（Netlify + Turso + R2）

```
浏览器 ←→ Netlify ←→ Turso 云端 (直接增量 SQL，无全量导出)
                │
                └─ 文件: R2 直接 302 跳转 (签名 URL)

特性:
  ● 每次写入 = 一次 HTTPS SQL 请求，无全量导出
  ● 文件 = 浏览器直连 R2，不经过服务器
  ● 无需本地磁盘，无备份开销
```

---

## 七、关键瓶颈对比

| 操作 | sql.js 模式 | Turso 模式 |
|------|-------------|------------|
| 写一条记录 | O(1) 内存写入 → O(n) 全量导出 | O(1) SQL over HTTP |
| 标记已读 | 微秒(内存) + 5秒后全量导出 | 几十毫秒 |
| 移动文件夹 | 同上 | 同上 |
| 书架列表 | O(n) 内存遍历 | O(n) SQL over HTTP |
| 文件访问 | 本地磁盘 I/O | R2 直接 302 跳转 |

**结论**: 你感受到的迟钝 = sql.js 模式下每次写操作最终都会触发
全库序列化 + 磁盘写入 + 备份复制。防抖只是让多次操作合并为一次，
但没有消除全量导出这个根本开销。部署到 Turso 模式后这个开销完全消失。
