# 数据架构长远规划

## 10 年数据量估算

| 维度 | 保守估计 | 积极估计 |
|------|----------|----------|
| 文章总数 | 2,000 篇 | 5,000 篇 |
| 每篇平均标记 | 20 个 | 50 个 |
| 标记总数 | 40,000 | 250,000 |
| 单词本单词数 | 10,000 | 50,000 |
| 知识要点 | 2,000 | 10,000 |
| 数据库文件大小 | 50 MB | 300 MB |

sql.js 全内存加载：300 MB 在 10 年后的设备上完全可控。真正的瓶颈不在内存，在于**全表 JSON 扫描**。

---

## 规划总览

```
当前                           Phase 1                  Phase 2                  Phase 3
                                (马上做)                  (数据破千篇时)            (数据破万标记时)

texts.marks (JSON)     →     marks 独立表          →     大文本外迁文件          →     物化统计表
全量扫描聚合           →     分页 + 索引           →     全文搜索优化            →     缓存层
```

---

## Phase 1：标记表独立化（现在就做）

### 问题

复习本、每日统计、每日洞察三个端点每次请求都扫描全部 `texts` 表，解析所有 marks JSON。10 年后 25 万条标记至少解析 25 万次 JSON 对象。

### 方案

新增独立的 `marks` 表：

```sql
CREATE TABLE marks (
  id          TEXT PRIMARY KEY,
  textId      TEXT NOT NULL,          -- FK → texts.id
  textTitle   TEXT DEFAULT '',        -- 冗余标题，避免 JOIN
  textFolder  TEXT DEFAULT '',        -- 冗余文件夹
  type        TEXT NOT NULL,          -- word / phrase / sentence
  text        TEXT NOT NULL,          -- 标记原文
  lemma       TEXT DEFAULT '',        -- 词元
  detail      TEXT DEFAULT '',        -- AI 解析结果（JSON）
  note        TEXT DEFAULT '',        -- 用户笔记
  createdAt   TEXT NOT NULL,
  updatedAt   TEXT
);

CREATE INDEX idx_marks_textId ON marks(textId);
CREATE INDEX idx_marks_type ON marks(type);
CREATE INDEX idx_marks_createdAt ON marks(createdAt DESC);
CREATE INDEX idx_marks_text ON marks(text);
```

### 改动点

**写入**：`text/update.post.ts` 中 `syncMarksToWordbooks` 和 `cleanupDeletedMarks` 同步维护 marks 表（新增标记时 INSERT，删除时 DELETE）

**读取**：

| 端点 | 旧查询 | 新查询 |
|------|--------|--------|
| reviews/list.get.ts | 全量扫 texts.marks JSON | `SELECT * FROM marks ORDER BY createdAt DESC LIMIT 200` |
| words/daily-stats.get.ts | 全量扫 JSON + 应用层分组 | `SELECT date(createdAt) as d, count(*) FROM marks GROUP BY d` |
| words/daily-detail.get.ts | 全量扫 JSON + 应用层过滤 | `SELECT * FROM marks WHERE date(createdAt)=?` |

### 兼容过渡

marks 表作为 texts.marks JSON 的**同步镜像**运行一段时间。所有写入同时维护两处，读取逐步切到 marks 表。确认稳定后删除 texts.marks 列（或保留为空数组做兜底）。

---

## Phase 2：大文本外迁 + 分页（数据破千篇时）

### 问题

每篇文章的 `text`（全文）和 `segments`（分段）是最大的字段，通常占一行数据的 90%。千篇文章后 DB 文件可能超过 100 MB，sql.js 每次启动加载整个 DB 到内存。

### 方案

- `text` 和 `segments` 从 SQLite 迁出，存为独立文件（已有的 `server/data/files/{folderId}/{contentId}/` 目录结构直接复用）
- texts 表保留 `textFilePath` 和 `segmentsFilePath` 两个路径字段
- 读取时按需从磁盘加载单个文件，而不是把全部文章内容加载到内存

### 数据库瘦身效果

假设 5,000 篇文章，平均每篇 15 KB：

| 存储位置 | 数据量 |
|----------|--------|
| SQLite（元数据 + 标记 + 其他） | ~50 MB |
| 文件系统（文本 + 分段） | ~75 MB |
| sql.js 内存占用 | 从 125 MB → 50 MB |

### 所有列表接口统一加分页

```
GET /api/reviews/list?page=1&pageSize=50
GET /api/words/daily-stats?page=1&pageSize=30
GET /api/knowledge/list?page=1&pageSize=20
GET /api/wordbooks/[id]/words?page=1&pageSize=50
```

返回格式统一为：
```json
{
  "items": [...],
  "total": 1240,
  "page": 1,
  "pageSize": 50,
  "hasMore": true
}
```

---

## Phase 3：物化统计 + 缓存（数据破万标记时）

### 问题

即使 marks 表有索引，`GROUP BY date(createdAt)` 扫描 10 万行仍然耗时。而且每日统计值几乎不变（昨天的数据不会改），反复查询是浪费。

### 方案

**物化统计表**：标记增删时增量更新，查询时直接读结果

```sql
CREATE TABLE daily_stats (
  date       TEXT PRIMARY KEY,
  wordCount  INTEGER DEFAULT 0,
  phraseCount INTEGER DEFAULT 0,
  sentenceCount INTEGER DEFAULT 0,
  totalCount INTEGER DEFAULT 0
);
```

每次 marks 表 INSERT 或 DELETE 时，用 `INSERT ... ON CONFLICT` 增量更新对应日期的计数：

```sql
INSERT INTO daily_stats (date, wordCount, totalCount)
VALUES (?, 1, 1)
ON CONFLICT(date) DO UPDATE SET
  wordCount = wordCount + 1,
  totalCount = totalCount + 1
```

**数据库定期维护**：

- 每次应用启动时执行 `PRAGMA optimize` 更新统计信息
- 每季度执行一次 `VACUUM` 回收删除标记产生的碎片
- 备份轮转保持最近 30 份（当前是 10 份）

---

## 实施优先级

| 优先级 | 改动 | 工作量 | 影响范围 | 理由 |
|--------|------|--------|----------|------|
| P0 | marks 独立表 | 中 | 3 个读端点 + 1 个写端点 | 唯一会随数据量线性恶化的路径 |
| P1 | 列表分页 | 小 | 全部 GET 列表端点 | 用 LIMIT 代替全量返回，改动小收益大 |
| P2 | 大文本外迁 | 中 | texts 读写 + DB 初始化 | 降低 sql.js 内存占用，千篇内不急 |
| P3 | 物化统计 | 小 | 1 个新表 + 标记写入链路 | 万级标记后才需要 |
| P4 | 全文搜索 | 中 | 搜索端点 | 可考虑 SQLite FTS5 扩展 |

---

## 不做的事

以下企业级方案明确**不引入**，因为它们增加运维负担，对个人项目弊大于利：

- 不用 PostgreSQL / MySQL —— sql.js 零运维，够用
- 不用 Elasticsearch —— SQLite FTS5 能解决全文搜索
- 不用 Redis 缓存 —— 数据量级不需要独立缓存进程
- 不用 ClickHouse —— 物化统计表足够
- 不用消息队列做 CDC —— 标记写入链路内联同步即可
