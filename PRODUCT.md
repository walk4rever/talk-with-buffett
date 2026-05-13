> 🔒 内部文件，不对外公开。

# 巴菲特部落 · Buffett Tribe — 产品与技术设计

> 最后更新：2026-05-13（v0.34.3）

---

## 产品定位

**Buffett Tribe** 是面向价值投资者的知识平台，而非单纯的 AI 问答工具。

核心差异：**精心策划的原始资料** + **AI 辅助研读**，强调"有来源可溯、有原文可查"。不做泛化知识问答，做有深度的投资人研究工具。

### 目标用户

| 用户 | 需求 | 核心功能 |
|------|------|---------|
| 价值投资者（C 端主力） | 读懂大师原文，辅助研究 | Library + Chat + Text Room |
| 金融 AI 应用开发者 | 调用结构化投资知识 | MCP Server + REST API |
| AI Agent 用户 | 工具调用做投资研究 | MCP tools |

### 访问路径

```
Buffett Tribe 知识平台
        │
   ┌────┴────────────────────────┐
   │                             │
 Web（消费者产品）          开放接口
 面向价值投资者              面向开发者 / AI Agent
   │                             │
buffett.air7.fun         MCP · REST API
读信 · 对话 · 研究          接入任意 agent 工作流
```

---

## 功能架构（当前 v0.34.3）

### 1. 资料库 · `/master/[id]/library`

按投资人 + 四分类（信件/文章/书籍/视频）组织的阅读系统。

**侧边栏导航：**
- 顶部 4 个 Category Tab：信件 · 文章 · 书籍 · 视频
- 信件：年份列表，每条带类型标签（致股东信 / 合伙人信）
- 文章：单篇列表（标题 + 日期）
- 视频：单个视频列表（标题 + 日期）
- 书籍：占位，建设中

**内容分类映射：**

| `Source.type` | 显示分类 | 备注 |
|--------------|---------|------|
| `shareholder` | 信件 | 致股东信 |
| `partnership` | 信件 | 合伙人信 |
| `annual_meeting` | 视频 | 股东大会 |
| `article` | 文章 | 公开文章 |
| `interview` | 文章 | 采访稿 |
| `post` | 文章 | 雪球等平台发言 |
| `speech` | 文章 | 演讲稿 |

**阅读组件：**
- `LetterReadingArea` — 信件阅读（年份+类型标题，字体/行距控件，FAB 进入 Text Room）
- `ArticleReadingArea` — 文章/视频阅读（文章标题+日期标题，同样控件）
- 两者共享 localStorage 字体/行距设置（key: `reader-font-idx` / `reader-line-idx`）

**性能设计：**
- `revalidate = 300`（5 分钟缓存，替代原 `force-dynamic`）
- 查询拆分：侧边栏只拉元数据（`id/type/year/date/title`），不拉 `contentMd`
- 正文按需加载：只拉当前激活那一篇的 `contentMd`（节省 ~3-8MB/请求）

### 2. 信件阅读 · `/letters/[type]/[year]`

独立信件阅读页，直接链接，SEO 友好。

- `revalidate = 3600`（1 小时缓存，信件内容不变）
- 使用 `LetterReadingArea`

### 3. 对话 · `/chat`

基于原始文献的 AI 对话。

**检索流程：**
```
用户提问
  ↓
Query Understanding（结构化：task_type / entities / year_range / keyword / semantic）
  ↓
并行召回（tsvector 关键词 + pgvector 语义，限 shareholder + partnership）
  ↓
RRF 融合重排 + 年份过滤
  ↓
段落级证据抽取
  ↓
Evidence-first 生成 + 来源引用
```

**task_type：**
- `fact` — 事实/时间线（关键词为主）
- `method` — 原则/方法（关键词 + 语义均衡）
- `chat` — 闲聊（最少检索）

### 4. 工作区 · `/text/room`（原 `/workspace`）

Chat + Canvas 分屏布局，阅读与对话双向联动。

- 左：Chat 对话
- 右（Canvas）：当前引用的原文，字体/行距可调
- Canvas 控件：`A−` / `A+` 字体，行距图标，与 Library 设置共享

URL 格式：`/text/room?source=shareholder&year=2024&t=标题`

### 5. 投资人主页 · `/master/[id]`

- 资料库入口卡片（信件/文章/书籍/视频各类统计）
- 持仓摘要（Top 10 + 本季变化）
- `revalidate = 300`

### 6. 持仓 · `/master/[id]/holdings`

- 13F 持仓分析，季度对比
- 新进/增持/减持/退出标的
- 数据来自 EDGAR，Python ETL 回填

### 7. 标的纵向叙事 · `/company/[ticker]`

三层叠加视图：
- Lane A：基本面（EDGAR XBRL — Revenue / FCF / EPS）
- Lane B：聪明钱矩阵（13F 持仓热力）
- Lane C：叙事图钉（Buffett 信件提及，含情感标注）

---

## API 参考

### MCP Server

```
端点：POST https://buffett.air7.fun/api/mcp
协议：MCP Streamable HTTP
认证：无（公开）
```

| 工具 | 参数 | 说明 |
|------|------|------|
| `search` | `query`, `yearFrom?`, `yearTo?`, `limit?` | 混合检索（关键词 + 语义） |
| `get_document` | `sourceId?` 或 `year` + `type`, `page?` | 获取完整文档（分页） |
| `graph` | `entity`, `yearFrom?`, `yearTo?`, `limit?` | 实体关系图谱 |

### REST API

```
Base URL: https://buffett.air7.fun
认证：无（公开接口）
```

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tools/search` | `?q=&yearFrom=&yearTo=&limit=` |
| GET | `/api/tools/document` | `?year=&type=&page=` 或 `?sourceId=&page=` |
| GET | `/api/tools/graph` | `?entity=&yearFrom=&yearTo=&limit=` |
| GET | `/api/source` | `?type=&year=` — 原始 Source 元数据列表 |

### Chat API（内部）

```
POST /api/chat          — SSE 流式问答
GET  /api/chat/history  — 对话历史
PATCH /api/chat/[id]/rating — 👍/👎 评分
```

### Auth API（内部）

```
POST /api/auth/register
POST /api/auth/forgot-password
POST /api/auth/reset-password
```

### ASR API（内部）

```
POST /api/asr/transcribe           — 音频转文字（文件上传）
POST /api/asr/transcribe-file
POST /api/asr/realtime/start       — 实时转录会话
POST /api/asr/realtime/[id]/chunk  — 发送音频块
GET  /api/asr/realtime/[id]/events — SSE 实时结果
POST /api/asr/realtime/[id]/finish — 结束会话
```

### Digital Human API（内部）

```
GET  /api/digital-human/jobs
GET  /api/digital-human/jobs/[id]
```

---

## 数据架构

### 核心数据模型

```
Source（原始资料）
├── id           -- cuid
├── type         -- 见分类映射表
├── year         -- 年份（信件按年导航）
├── date         -- 精确日期（文章/帖子）
├── title        -- 标题
├── url          -- 原文链接
├── contentMd    -- 完整 markdown
├── videoUrl     -- 视频链接（大会/采访）
├── videoSource  -- 'youtube' | 'bilibili'
└── chunks[]     -- 1:N，切分后的段落

Chunk（检索单元）
├── id
├── sourceId     → Source
├── order        -- 段落顺序
├── title        -- 章节标题（English）
├── sectionZh    -- 章节标题（中文）
├── contentEn    -- 英文段落
├── contentZh    -- 中文段落
├── embedding    -- vector(1024)，doubao text-embedding-v3
└── searchVector -- tsvector，英文全文索引
```

### 纵向叙事扩展表（标的分析）

```
Entity        -- 公司/人物/概念，SEC CIK 为主键
ExtSource     -- 外部数据来源（10-K / 13F / XBRL）
Mention       -- chunk 中的实体提及（含情感 -1~1）
Financial     -- EDGAR XBRL 财务数据
Holding       -- 13F 持仓记录
EntityRelation-- 实体间语义关系
```

### Embedding 方案

- 模型：火山引擎 doubao `text-embedding-v3`，1024 维
- 向量化字段：`contentZh`（中文，跨语言覆盖英文 query）
- 索引：pgvector HNSW
- 跳过：`skipEmbedding = true` 的表格 chunk

---

## 投资人扩展设计

### 内容形态对应关系

| 投资人 | 主要内容形态 | Library 导航方式 |
|--------|------------|----------------|
| 巴菲特 | 年度信件（一年一封） | 信件 Tab → 年份树 |
| 李录 | 演讲稿、书籍 | 文章 Tab → 单篇列表；书籍 Tab |
| 段永平 | 雪球帖子（碎片化） | 文章 Tab → 单篇列表（每条独立） |

**关键设计决策**：Library 的分类（信件/文章/书籍/视频）是人无关的通用框架，不同投资人在同一框架下呈现不同内容形态。侧边栏导航逻辑由内容的 `type` 字段决定，无需为每个投资人单独写导航组件。

### 未来 `Source` 表扩展

段永平的雪球帖子在 `Source` 入库时，`type = "post"`，`date` 字段填具体发帖日期，`year` 字段填年份。Library 页的文章 Tab 自动按 `date` 倒序展示，无需改动导航逻辑。

---

## 前端架构

### 路由结构

```
/                          -- 首页（投资人列表 + 功能入口）
/chat                      -- 全屏对话
/text                      -- Text Room 入口页
/text/room                 -- Chat + Canvas 分屏工作区
/letters/[type]/[year]     -- 信件独立阅读页（SEO 友好）
/master/[id]               -- 投资人主页
/master/[id]/library       -- 四分类资料库
/master/[id]/holdings      -- 13F 持仓分析
/company/[ticker]          -- 标的纵向叙事
/avatar                    -- 数字人演示
/login · /contact · /privacy-policy · /terms-of-service
```

### 关键组件

| 组件 | 用途 |
|------|------|
| `LetterReadingArea` | 信件阅读（sticky bar、字体/行距控件、FAB） |
| `ArticleReadingArea` | 文章/视频阅读（同上，标题栏不同） |
| `TextRoomWorkspace` | Chat + Canvas 分屏，含 Canvas 阅读控件 |
| `SiteNav` | 全局顶部导航 |

### 缓存策略

| 页面 | 策略 | 时长 |
|------|------|------|
| `/letters/[type]/[year]` | `revalidate` | 3600s（1h） |
| `/master/[id]/library` | `revalidate` | 300s（5min） |
| `/master/[id]` | `revalidate` | 300s（5min） |
| `/api/chat` | `force-dynamic`（SSE） | — |

---

## 基础设施

| 层 | 技术 | 状态 |
|----|------|------|
| 部署 | Vercel 新加坡 | ✅ |
| 数据库 | Supabase PostgreSQL 新加坡 | ✅ |
| 向量索引 | pgvector HNSW | ✅ |
| 全文索引 | tsvector + GIN | ✅ |
| 限流 | Upstash Redis 新加坡 | ✅ |
| 认证 | NextAuth Credentials | ✅ |
| 行为追踪 | PostHog Cloud | ✅ |
| AI 对话 | 火山引擎（OpenAI 兼容） | ✅ |
| ETL（持仓/财报） | Python + edgartools，阿里云轻量服务器 | ✅ |
| 支付 | LemonSqueezy（MVP） | 🔲 |
| 数字人 | 第三方 API | 🔲 |

---

## 商业化

### 收费模式

| 层级 | 价格 | 权益 |
|------|------|------|
| 免费 | 0 | 30 次对话/天（`FREE_DAILY_CHAT_LIMIT`）；完整阅读功能 |
| 订阅会员 | 待定 | 无限对话；未来付费专属内容 |

### 支付渠道

- MVP：LemonSqueezy（无需营业执照，支持信用卡）
- 正式：Ping++（微信/支付宝，需营业执照）

---

## 评测 Benchmark（检索质量）

30 题覆盖 Facts（60%）/ Principles（30%）/ Chat（10%）。

**当前最优 commit**：`76a69ce`，weightedAvgHits 7.54，fact.avgHits 8.0，fact.zeroHitCount 0。

**已知问题**：投资方法类问题（M006、M009）偶被错误归入 `chat`，意图分类待改进。

---

## 项目级决策

| # | 决策 | 理由 |
|---|------|------|
| P1 | 内容质量优先，不做通用 RAG 平台 | 壁垒在精心策划的内容，不在基础设施 |
| P2 | RAG 而非 fine-tune | 可追溯来源，成本低，迭代快 |
| P3 | 四分类（信件/文章/书籍/视频）人无关框架 | 巴菲特/李录/段永平共用同一导航逻辑 |
| P4 | 导航分类在代码层做映射，不加 DB `category` 字段 | 现有 type 字段已确定，映射关系稳定，无需 DB 迁移 |
| P5 | Library 查询拆分（导航 + 内容两次查询） | 避免 60 封信全量加载 contentMd，节省 ~3-8MB/请求 |
| P6 | force-dynamic → revalidate | 信件内容不变，缓存大幅提升响应速度 |
| P7 | 目标市场：中国为主 | 中文解读 + 原文对照是核心护城河 |
| P8 | 部署：Vercel 新加坡 | 中国可达，无需备案，serverless 运维成本低 |
| P9 | 认证：Credentials，不用 OAuth | GitHub/Google OAuth 在中国被封 |
| P10 | 段永平雪球帖子归入「文章」类 | 无需独立分类，单篇导航方式完全适用 |

---

*本项目与任何投资人本人及其所属机构无任何关联。所有内容基于公开资料，仅供学习研究使用。不构成任何投资建议。*
