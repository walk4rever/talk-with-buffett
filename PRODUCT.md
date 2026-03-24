> 🔒 内部文件，不对外公开。

# Talk with Buffett — 产品与技术设计

> 最后更新：2026-03-23

## 数据架构

### 数据来源

| 内容类型 | 英文标识 | 状态 | 数据源 | 数量 |
|---------|---------|------|--------|------|
| 股东信 | `shareholder` | ✅ 已有 | [Yestoday](https://github.com/pzponge/Yestoday) | 61 篇（1965-2025） |
| 合伙人信 | `partnership` | ✅ 已有 | Yestoday | 33 篇（1957-1970） |
| 股东大会 | `annual_meeting` | ✅ 已有 | Yestoday | 34 篇（1985-2024），2556 chunks |
| 公开文章 | `article` | 🆕 待收集 | Fortune 等刊物 | ~10-20 篇 |
| 公开采访 | `interview` | 🆕 待收集 | CNBC/Bloomberg 等 | 待定 |

所有内容类型的原始数据格式一致：中英文交替的 markdown 文件，按标题切分。

### 数据模型

```
Source（原 Letter，重命名）
├── id               -- cuid
├── type             -- 'shareholder' | 'partnership' | 'article' | 'annual_meeting' | 'interview'
├── year             -- 年份
├── date             -- 精确日期（合伙人信、文章发表日等），可为空
├── title            -- 标题
├── url              -- 原文链接
├── contentMd        -- 完整 markdown（信件原文 / 转录文本，原样保存）
├── videoUrl         -- 视频链接（大会/采访），可为空
├── videoSource      -- 视频平台（'youtube' | 'bilibili' | 'cnbc' 等），可为空
├── thumbnailUrl     -- 封面图，可为空
├── createdAt
├── updatedAt
└── chunks[]         -- 1:N

Chunk（不变）
├── id
├── sourceId         → Source（原 letterId）
├── order            -- 在内容中的顺序
├── title            -- 章节标题（如 "Focus on the Forest"），可为空
├── contentEn        -- 英文段落
├── contentZh        -- 中文段落
├── embedding        -- vector(1024)，基于 contentEn
├── searchVector     -- tsvector，基于 contentEn
├── createdAt
└── updatedAt
```

### 模型设计决策

| # | 决策 | 理由 |
|---|------|------|
| D11 | Letter 重命名为 Source | 语义准确，涵盖信件/文章/转录等所有内容类型 |
| D12 | 单表 + type 字段，不做多表 | 字段高度重叠，查询简单，避免 JOIN 复杂度 |
| D13 | 视频字段放 Source 上 | 视频是 Source 的属性，不是独立实体 |
| D14 | 不新建 Transcript 表 | 转录文本就是 contentMd，格式与信件一致（中英 markdown），复用 Chunk 检索 |

### 切分策略

所有内容类型共用同一套切分逻辑：

1. 按 `#` / `##` 标题切分为章节
2. 无标题的早期信件（1965-1976 等）按段落切分
3. 超长章节按段落二次切分（上限 ~800 token）
4. 每个 chunk 内分离中英文：CJK 字符开头的段落为中文，否则为英文

股东大会转录的 Q&A 天然按 `##` 编号切分（如 `## 2. Buffett loses "Miss Congeniality" title`），与信件处理流程完全一致。

### 阅读展示

- 直接渲染 `Source.contentMd`，用 `react-markdown` + `remark-gfm`
- 中英交替显示（原始 markdown 格式）
- 支持单语过滤（EN / 中文模式：渲染时按段落语言过滤）
- 有视频的内容类型，阅读页顶部嵌入视频播放器

## 交互系统

### 核心理念

两种交互模式（文本对话 + 数字人对话），多种入口，统一终态。

### 独立页面（入口）

| 路由 | 用途 | 状态 |
|------|------|------|
| `/chat` | 全屏文本对话 | ✅ |
| `/letters/shareholder/2024` | 股东信阅读 | ✅ |
| `/letters/partnership/1965` | 合伙人信阅读 | ✅ |
| `/letters/annual_meeting/2008` | 股东大会阅读 | ✅ |
| `/articles/[slug]` | 文章阅读 | 🆕 |
| `/videos/interview/[id]` | 采访视频 + 转录 | 🆕 |

独立页面是用户的入口，提供沉浸式阅读/观看/对话体验。

### 统一工作区（终态）

所有入口通过触发操作，收敛到同一个**Chat + Canvas 分屏布局**：

```
独立页面                              统一工作区
───────────                          ──────────────────
/chat        ──点击引用──→           ┌──────┬──────────┐
                                    │      │          │
/letters/... ──点击对话──→           │ Chat │  Canvas  │
                                    │      │ (信件/   │
/videos/...  ──点击对话──→           │      │  视频/   │
                                    │      │  文章)   │
/articles/.. ──点击对话──→           │      │          │
                                    └──────┴──────────┘
```

### 工作区规则

| 规则 | 方案 |
|------|------|
| Canvas 内容 | 单个，点击新引用直接替换 |
| 移动端 | Chat ↔ Canvas 全屏切换，非分屏 |
| 阅读状态 | 记住每个内容的滚动位置（内存缓存） |
| URL | 有独立 URL，支持刷新和分享 |
| 退出分屏 | 关闭按钮收起一侧，回到单侧视图 |

工作区 URL 示例：
```
/workspace?source=shareholder&year=2024
/workspace?source=annual_meeting&year=2023
```

对话历史走客户端状态，不编码进 URL。

### 引用与跳转

chat 引用来自不同内容类型时，展示标签适配：

```
shareholder   → "2024年股东信 · Focus on the Forest"
partnership   → "1965年合伙人信"
article       → "1984年文章 · The Superinvestors of Graham-and-Doddsville"
annual_meeting → "2023年股东大会 · Q23: Why not invest in tech?"
interview     → "2023年CNBC采访 · Becky Quick"
```

点击引用 → 在 Canvas 中打开对应内容，定位到引用段落。

## 检索系统（v2）

当前阶段对话检索范围**只包含股东信 + 合伙人信**：

```
Source.type IN ('shareholder', 'partnership')
```

股东大会、采访、文章继续保留阅读能力，但不进入对话检索主链路，等 v2 稳定后再扩容。

### D1: 不再使用“单点路由二选一”

**方案**：LLM 不负责决定“只跑关键词或只跑语义”，而是只负责输出结构化问题理解。

**理由**：
- 单点路由选错一次就全错
- 并行多路召回更稳健，便于回归测试

### D2: Query Understanding 结构化输出

**方案**：先把用户问题解析为统一 JSON：
- `intent`：fact / timeline / opinion / compare / chat
- `entities`：公司、人名、事件
- `year_from` / `year_to`
- `keyword_query`（精确召回）
- `semantic_query`（语义召回）
- `answer_mode`：concise / timeline / compare

**理由**：
- 多轮追问、口语表达可以先归一化再检索
- 检索与生成解耦，定位问题更容易

### D3: 并行召回 + 融合重排

**方案**：
- 关键词路（tsvector）召回 top-k
- 向量路（pgvector）召回 top-k
- RRF/加权融合后去重，得到统一候选

**理由**：
- 关键词擅长实体精确命中，向量擅长语义扩展
- 融合后对 query phrasing 变化更鲁棒

### D4: 只对英文建索引（保持不变）

**方案**：`searchVector` 与 `embedding` 都基于 `contentEn`。中文问题先做英文化检索表达。

### D5: 全部在 PostgreSQL 内完成（保持不变）

**方案**：tsvector + GIN、pgvector + HNSW，不引入外部检索引擎。

### D6: 引用精度升级为“段落级摘取”

**方案**：检索命中 chunk 后，在 chunk 内做 query-aware passage 抽取，返回最小可读证据段落作为引用。

**理由**：
- 比“固定截取前 80/150 字符”更精准
- 用户点击引用时更容易验证答案

## 生成机制（Evidence-first）

**方案**：先证据规划，再生成回答。

1. 从融合候选中选出证据集合（覆盖实体/年份/子问题）
2. 形成内部 evidence plan（不对用户展示）
3. LLM 严格基于证据生成中文回答
4. 若证据不足，明确告知“未检索到足够原文”

## 检索流程（v2）

```
用户提问
  │
  ├─① Query Understanding（结构化）
  │    输出 intent/entities/time/keyword_query/semantic_query
  │
  ├─② 并行召回（限定 shareholder + partnership）
  │    ├─ 关键词路：tsvector top-k
  │    └─ 语义路：pgvector top-k
  │
  ├─③ 融合重排 + 去重（RRF/加权）
  │
  ├─④ 段落级证据抽取（query-aware passage）
  │
  └─⑤ Evidence-first 生成回答 + 返回来源
```

## Embedding 方案

- **模型**：火山引擎多模态 embedding API（`ep-20260322020312-4xfnx`）
- **维度**：1024，HNSW 索引
- **生成方式**：一次性脚本跑全量，新数据增量生成
- **API 配置**：`EMBEDDING_API_KEY` / `EMBEDDING_API_BASE_URL` / `EMBEDDING_MODEL`

## 视频播放

### 存储策略

不自建视频存储，引用外部平台链接。

| 平台 | 场景 | 播放方式 |
|------|------|---------|
| YouTube | 海外采访、部分股东大会 | iframe embed |
| Bilibili | 中国用户可达的镜像 | iframe embed |

`Source.videoUrl` 存视频链接，`Source.videoSource` 标记平台类型，前端根据平台选择播放器。

### 视频页面布局

```
┌─────────────────────────────────────┐
│  视频播放器（YouTube/Bilibili embed）  │
├─────────────────────────────────────┤
│  转录文本（复用 LetterReadingArea）     │
│  中英交替 / 单语过滤                    │
│                                     │
│  💬 点击"对话"进入工作区分屏            │
└─────────────────────────────────────┘
```

## 用户数据与反馈系统

MVP 阶段需要回答两个问题：用户怎么用的？用得好不好？

### 分工：PostHog + 自建 ChatMessage

行为追踪和对话记录分开处理：

```
行为数据 → PostHog（page_view, 点击, 漏斗, session recording）
对话数据 → ChatMessage 表（消息内容, 来源关联, 用户评分）
```

### ChatMessage（自建，PostgreSQL）

```
ChatMessage（对话记录）
├── id
├── sessionId        -- 同一次对话的消息共享 sessionId
├── userId           -- 登录用户关联，可为空
├── ip               -- 未登录用户用 IP 标识
├── role             -- 'user' | 'assistant'
├── content          -- 消息内容
├── sourceChunkIds   -- 本轮检索命中的 chunk ID 列表（仅 assistant 消息）
├── rating           -- 用户反馈 'up' | 'down'，可为空
├── createdAt
└── updatedAt
```

**用途**（运营视角）：
- 用户最常问什么话题？（聚类分析 user 消息）
- 哪些问题检索不到好的来源？（sourceChunkIds 为空或 rating=down）
- 对话轮数分布？（按 sessionId 统计）
- 👍/👎 比例趋势？

### PostHog（行为追踪）

使用 PostHog Cloud，通过 `posthog-js` + Next.js integration 接入。

追踪的关键事件：

| 事件名 | 触发时机 | properties 示例 |
|--------|---------|----------------|
| `page_view` | 页面加载 | `{ path, sourceType, year }` |
| `chat_start` | 发送第一条消息 | `{ entry: 'chat_page' \| 'letter_page' \| 'workspace' }` |
| `chat_message` | 发送消息 | `{ messageLength }` |
| `chat_rating` | 点击👍👎 | `{ rating, messageId }` |
| `source_click` | 点击引用来源 | `{ sourceType, year, chunkId }` |
| `reading_mode_change` | 切换阅读模式 | `{ mode: 'bilingual' \| 'en' \| 'zh' }` |
| `workspace_enter` | 进入分屏工作区 | `{ from: 'chat' \| 'letter' \| 'video' }` |
| `workspace_exit` | 退出分屏 | `{ duration }` |
| `waitlist_submit` | 提交 waitlist | `{ source }` |
| `register` | 注册 | `{}` |

PostHog 额外提供（无需开发）：
- **Session Recording** — 回放用户操作，种子期理解用户行为极有价值
- **Funnels** — 访问 → 阅读 → 对话 → 注册的转化漏斗
- **Heatmaps** — 页面点击热区
- **Feature Flags** — 后续 A/B 测试直接用

**中国可达性**：先用云版验证（种子期量小，偶尔丢事件可接受）；如不稳定再自托管（Docker 一键部署）。

### 用户反馈入口

```
对话气泡
┌─────────────────────────┐
│  巴菲特的回答...          │
│                         │
│              👍  👎      │  ← 每条 assistant 消息
└─────────────────────────┘
```

点击后写入 `ChatMessage.rating` + PostHog `chat_rating` 事件，双写。

### 设计决策

| # | 决策 | 理由 |
|---|------|------|
| D15 | 对话记录自建 ChatMessage 表 | 结构化业务数据（内容、引用关联、评分），需要 SQL 做质量分析，不适合塞进 PostHog |
| D16 | 行为追踪用 PostHog，不自建 | Session recording + funnels + heatmaps 对种子期极有价值，自建成本高且功能弱 |
| D17 | PostHog Cloud 优先，自托管备选 | 零运维快速上线；中国不可达时切换 Docker 自托管 |
| D18 | 评分数据双写 | ChatMessage 存结构化关联（哪条消息、哪些来源），PostHog 存行为趋势（时间分布、用户画像） |

## 商业化

### 收费模式

免费 + 订阅制：

| 层级 | 价格 | 权益 |
|------|------|------|
| 免费 | 0 | 30 次对话/天（已有 `FREE_DAILY_CHAT_LIMIT`） |
| 订阅会员 | 待定（月/年） | 更多或无限对话次数 |

### 支付渠道

| 阶段 | 方案 | 理由 |
|------|------|------|
| MVP/种子期 | LemonSqueezy | 无需营业执照，支持信用卡/PayPal，快速上线 |
| 正式运营 | 待定（Ping++ 等） | 需要微信/支付宝时再迁移，需营业执照 |

### 设计决策

| # | 决策 | 理由 |
|---|------|------|
| D19 | 免费 + 订阅制，不按次收费 | 订阅制收入可预测，用户无"每次点击都在花钱"的焦虑 |
| D20 | LemonSqueezy 种子期 | 零门槛接入，验证付费意愿；种子用户（投资者/金融从业者）多数有信用卡 |

## 项目级决策

| # | 决策 | 理由 |
|---|------|------|
| P1 | 数据先行，虚拟人后做 | 没有灵魂的身体是空壳 — 先结构化知识，再做对话 |
| P2 | RAG 而非 fine-tune | 可追溯来源，成本低，迭代快；fine-tune 是优化项 |
| P3 | 虚拟人用 API 而非自建 | 业余项目优先用成熟方案，不造轮子 |
| P4 | 目标市场：中国为主 | 中文解读 + 原文对照是核心护城河，英文市场竞争激烈且优势不明显 |
| P5 | 部署：Vercel 新加坡 | 中国可达，无需备案，serverless 运维成本低；规模化后评估迁移阿里云 |
| P6 | 数据库：Supabase PostgreSQL | Vercel serverless 不支持 SQLite；Prisma schema 迁移成本极低 |
| P7 | 认证：当前 Credentials，未来手机号短信 | GitHub/Google OAuth 在中国被封；手机号是国内最低摩擦的注册方式 |

## 迁移兼容性

| 环境 | tsvector + GIN | pgvector + HNSW | 迁移成本 |
|------|:-:|:-:|------|
| Supabase（当前） | 内置 | 内置扩展 | — |
| 阿里云 RDS PostgreSQL | 内置 | 支持（PG ≥ 14） | 换 DATABASE_URL |

## 基础设施状态

| 层 | 当前 | 未来（按需） |
|---|---|---|
| 数据库 | ✅ Supabase PostgreSQL 新加坡 | 阿里云 RDS |
| 认证 | ✅ NextAuth Credentials | 手机号 + 阿里云短信 |
| 限流 | ✅ Upstash Redis 新加坡 | — |
| 支付 | 🆕 LemonSqueezy（MVP） | Ping++（微信/支付宝，需营业执照） |
| 行为追踪 | 🆕 PostHog Cloud | PostHog 自托管 |
| 日志监控 | 未接入 | Vercel Analytics + Sentry |

## NOT in scope（明确延后）

| 事项 | 理由 |
|------|------|
| 自训练虚拟人模型 | API 方案足够，自训练 ROI 不高 |
| 英文版 / 多语言 | 先在中国市场跑通商业模式，再考虑出海 |
| 微信登录 | 需要公众号资质，个人开发者暂时做不了 |
| Ping++ 支付 | 需要营业执照，MVP 阶段用 LemonSqueezy |
| Fine-tune 模型 | RAG 方案已满足需求，fine-tune 是优化项 |

## 实施优先级

### MVP（当前阶段）— 找种子用户、验证付费意愿

目标：完整的对话+阅读体验 + 数据追踪 + 支付链路，可以交给真实用户使用。

```
Phase A：数据模型重构（Letter → Source）          ✅ v0.13.0
  ├─ Prisma schema 重命名 + 新增字段
  ├─ 代码全量替换（search.ts, prompts, API, 页面）
  ├─ import 脚本适配
  └─ 验证：现有功能不受影响

Phase B：股东大会数据导入                         ✅ v0.15.0–v0.16.1
  ├─ 导入 34 篇大会转录（1985-2024，2556 chunks）
  ├─ 首页大会分区
  ├─ 大会阅读页（复用 LetterReadingArea）
  ├─ data/ 目录重组为 shareholder/partnership/annual_meeting/
  ├─ import 脚本重写：按 data/<type>/ 约定 + --file 单文件导入
  └─ 验证：检索覆盖大会内容

Phase C：统一工作区                               ✅ v0.14.0
  ├─ Chat + Canvas 分屏组件
  ├─ 引用点击 → Canvas 打开内容
  ├─ 独立页面点击对话 → 进入工作区
  ├─ 工作区 URL + 状态管理
  ├─ 移动端全屏切换
  ├─ 共享 chat 类型和 SSE 客户端（lib/chat.ts）
  └─ 验证：两种入口收敛到同一终态

Phase F：用户数据 + 支付
  ├─ ChatMessage 表 + 对话记录写入
  ├─ 对话评分（👍👎）
  ├─ PostHog 接入（行为事件 + session recording）
  ├─ LemonSqueezy 订阅集成
  ├─ 订阅状态校验（免费 vs 会员的次数限制）
  └─ 验证：完整的免费→付费转化链路
```

### Post-MVP — 内容扩展 + 体验增强

```
Phase D：视频播放支持
  ├─ 视频播放页（embed 播放器 + 转录文本）
  ├─ 首页视频分区
  └─ 工作区 Canvas 支持视频内容

Phase E：公开文章 + 采访
  ├─ 收集文章链接 + markdown
  ├─ 文章导入 + 阅读页
  ├─ 采访视频 + 转录导入
  └─ 首页对应分区
```
