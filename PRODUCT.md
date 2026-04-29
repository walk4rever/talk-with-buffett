> 🔒 内部文件，不对外公开。

# 巴菲特部落 · Value Archive — 产品与技术设计

> 最后更新：2026-04-29（v0.31.0）

---

## 产品定位

**Value Archive**（巴菲特部落）是一个面向 AI Agent 生态的投资知识 API + MCP 服务。

把伟大价值投资人的公开著作、演讲与信件，结构化为可程序化访问的知识图谱。以巴菲特为起点，向 Munger、Graham、Lynch、Klarman 等价值投资先驱扩展。目标是成为 AI Agent 时代**投资研究的标准知识源**。

### 访问路径

```
Value Archive 知识图谱
        │
   ┌────┴────────────────────────┐
   │                             │
 Web（我们做）              开放给外部
 面向普通用户               面向开发者 / AI Agent
   │                             │
buffett.air7.fun     MCP · REST API · CLI
与巴菲特对话          接入任意 agent 工作流
```

- **Web**：我们自己做的第一个消费者，产品门面。普通用户通过对话访问知识。
- **MCP**：AI Agent 的标准接入协议，优先级最高。Claude Desktop / Claude Code 一行配置即用。
- **REST API**：开发者构建自己的 AI 应用，调用知识检索工具。
- **CLI**：脚本调用、调试、自动化，可选。

### 优先级

```
知识图谱（数据质量）   ← 所有消费者的基础，现在做
       ↓
MCP Server            ← 主要商业路径，下一步
       ↓
REST API              ← 与 MCP 共用实现，同步
       ↓
Web UI 增强           ← 持续迭代，不阻塞服务层
       ↓
CLI                   ← 可选，按需
```

### 为什么是知识图谱，而不只是 RAG

普通 RAG 能回答"巴菲特说了什么"，但无法回答结构化问题：
- 某概念在 30 年间如何演变？
- 护城河与定价权之间是什么关系？
- 列出所有他明确买入又卖出过的公司

知识图谱让这类**结构化事实查询**和**跨时间推理**成为可能。三路融合检索：pgvector（语义）+ tsvector（全文）+ Neo4j（图结构）。

### 为什么不做通用 RAG 平台

通用 RAG 基础设施赛道有 Dify、LlamaIndex、微软 GraphRAG，竞争激烈且无资源优势。

Value Archive 的壁垒是**内容质量**，不是基础设施：
- 精心策划的实体关系与知识图谱 schema
- 多投资人、跨年代的结构化知识，内容积累越深越难复制
- 专为 AI Agent 生态设计的工具接口

### 目标客户

| 客户 | 需求 | 付费意愿 |
|------|------|---------|
| 金融 AI 应用开发者 | 调用 API 访问结构化投资智慧 | 高 |
| Claude Code / AI Agent 用户 | MCP tool，做投资研究 | 中 |
| C 端投资者 | Chat 对话 | 低 |

B2B API 优先验证，C 端 chat 持续运营。

---

## 数据架构总览

### PostgreSQL vs Neo4j — 互补，不冗余

```
PostgreSQL (Supabase)              Neo4j
─────────────────────              ─────────────────
原始内容 (Source / Chunk)           知识关系 (实体 / 图)
向量检索 (pgvector)                 图遍历 (Cypher)
全文检索 (tsvector)                 结构化事实查询
用户数据 (User / ChatUsage)         概念演变推理
账单 / 限流                         跨投资人对比

连接点：Neo4j Paragraph.id = PostgreSQL Chunk.id
```

- **PostgreSQL** = 内容仓库 + 向量/全文索引 + 用户数据。所有原始文本和 embedding 存这里。
- **Neo4j** = 关系索引。存实体之间的关系，段落节点只存 ID，全文回 PostgreSQL 取。
- **pgvector / tsvector** 是 PostgreSQL 的扩展功能，不是独立系统。

### 三路检索融合

| 问题类型 | 检索路径 |
|---------|---------|
| 语义/概念类 | pgvector 向量检索 |
| 精确术语/人名 | tsvector 全文检索 |
| 结构化事实/枚举 | Neo4j 图查询 |
| 复杂问题 | 三路融合，结果合并 |

---

## 知识图谱架构（多投资人）

### 核心 Schema 设计原则

从一开始为多投资人设计，Munger / Graham / Lynch 接入时不改 schema：

```cypher
// 节点
(:Investor {id, name, zh, born, style})
(:Document {id, type, year, date, investorId, title})
(:Concept  {id, name, zh, domain})
(:Company  {id, name, zh, ticker, cik})
(:Paragraph {id, order, title, text, year, investorId})

// 关系
(Investor)-[:WROTE]->(Document)
(Investor)-[:HOLDS_VIEW {year, evolution}]->(Concept)
(Document)-[:CONTAINS]->(Paragraph)
(Paragraph)-[:MENTIONS]->(Concept)
(Paragraph)-[:MENTIONS]->(Company)
(Concept)-[:RELATES_TO {type}]->(Concept)
(Company)-[:EXEMPLIFIES]->(Concept)
```

### MCP 工具设计

| 工具 | 输入 | 用途 |
|------|------|------|
| `semantic_search` | query, investor?, year_range?, limit | 语义检索段落 |
| `graph_facts` | entities[], investor?, relation?, year_range | 结构化事实查询 |
| `full_text_search` | keywords[], investor?, year_range | 精确术语查询 |
| `find_concept_evolution` | concept, investor?, year_range | 概念随时间的演变 |
| `compare_investors` | concept, investors[] | 多投资人观点对比（独特价值） |
| `list_company_mentions` | company, investor? | 公司在文献中的所有提及 |

### 实施路线

```
Step 1  重新设计 Neo4j schema（多投资人兼容）
Step 2  LLM 批量提取 Buffett triplets，替代现有 keyword 匹配
Step 3  建 MCP server，暴露核心工具
Step 4  Munger 语料接入，验证 schema 可扩展
Step 5  对外发布 API / MCP
```

---

## 商业化（更新）

### 双轨收费

| 客户 | 模式 | 定价方向 |
|------|------|---------|
| 开发者 / AI Agent | API 调用计费 / 订阅制 | 按月请求量阶梯 |
| C 端用户（chat） | 免费 + 订阅制 | 保持现有模型 |

### 优先级调整

B2B API 面向金融 AI 应用开发者，付费意愿高于 C 端散户，优先验证。

---

## Buffett 模块

> 以下为 Buffett 模块的详细技术设计，其他投资人模块复用同一框架。

---

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

#### 文件命名约定

**Shareholder Letters（1965–2025）**

- 文件数：63 个（61 封信 + `Berkshire_Performance_Book_Value.md` + `Berkshire_Performance_Market_Value.md`）
- 命名规则：`YYYY_Letter_to_Berkshire_Shareholders.md`
- year 提取：`filename[:4]`
- letter_type：`shareholder_letter`（2025 文件为 `news_release`）
- 结构：双语交替段落，`##` 主章节，`###` 子章节，无 H1

**Partnership Letters（1957–1970）**

- 文件数：33 个
- 命名规则：`YYYYMMDD_Letter_RR.md`
- year 提取：`filename[:4]`，date 提取：`filename[:8]`
- letter_type：`partnership_letter`
- 结构：双语交替段落，`##` 主章节，`###` 子章节，无 H1
- 特殊：正文中含 `（译注：...）` 内嵌注释，属于中文译文的一部分，保留不处理

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

#### 数据库 Schema（PostgreSQL）

```sql
CREATE TABLE chunks (
    id              SERIAL PRIMARY KEY,
    chunk_id        TEXT UNIQUE NOT NULL,       -- "shareholder_1989_12"
    source          TEXT NOT NULL,              -- 原始文件名
    corpus          TEXT NOT NULL,              -- "shareholder" | "partnership"
    year            INTEGER,
    date            TEXT,                       -- partnership 用，"19680124"
    letter_type     TEXT NOT NULL,
    section_en      TEXT,
    section_zh      TEXT,
    chunk_index     INTEGER NOT NULL,
    en_text         TEXT,
    zh_text         TEXT,
    skip_embedding  BOOLEAN DEFAULT FALSE,
    embedding       VECTOR(1024)                -- doubao text-embedding-v3
);

-- 索引
CREATE INDEX ON chunks USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX ON chunks (year);
CREATE INDEX ON chunks (corpus);
CREATE INDEX ON chunks (letter_type);
-- 全文检索（英文）
CREATE INDEX ON chunks USING GIN (to_tsvector('english', en_text));
```

### 模型设计决策

| # | 决策 | 理由 |
|---|------|------|
| D11 | Letter 重命名为 Source | 语义准确，涵盖信件/文章/转录等所有内容类型 |
| D12 | 单表 + type 字段，不做多表 | 字段高度重叠，查询简单，避免 JOIN 复杂度 |
| D13 | 视频字段放 Source 上 | 视频是 Source 的属性，不是独立实体 |
| D14 | 不新建 Transcript 表 | 转录文本就是 contentMd，格式与信件一致（中英 markdown），复用 Chunk 检索 |

### 切分策略（Chunk 设计）

#### 核心单元

**1 个 EN 段落 + 对应 ZH 段落 = 1 个 chunk**

```
英文段落

中文段落
```

以空行（`\n\n`）为段落边界。

所有内容类型共用同一套切分逻辑：

1. 按 `##` / `###` 标题切分为章节
2. 无标题的早期信件（1965-1976 等）按段落切分
3. 超长章节按段落二次切分（上限 ~800 token）
4. 每个 chunk 内分离中英文：CJK 字符开头的段落为中文，否则为英文

股东大会转录的 Q&A 天然按 `##` 编号切分（如 `## 2. Buffett loses "Miss Congeniality" title`），与信件处理流程完全一致。

#### 段落语言判断

```python
import re

def is_chinese(text):
    return bool(re.search(r'[\u4e00-\u9fff]', text))
```

含汉字 → ZH 段落；否则 → EN 段落。

#### 标题处理

遇到 `##` 或 `###` 标题行：
- **不生成 chunk**
- 提取为 `section_en` / `section_zh`，更新当前 section 状态
- 子章节路径用 `>` 拼接

```python
def parse_heading(line):
    text = line.lstrip('#').strip()
    match = re.search(r'[\u4e00-\u9fff]', text)
    if match:
        en = text[:match.start()].strip()
        zh = text[match.start():].strip()
    else:
        en, zh = text, None
    return en, zh

# 遇到 ### 时，拼接父级：
# section_en = "Non-Insurance Operations > See's Candies"
# section_zh = "非保险经营 > 喜诗糖果店"
```

#### 跳过的行类型

| 行类型 | 识别方式 | 处理 |
|--------|---------|------|
| 章节标题 | `^#{1,4}\s` | 更新 section metadata |
| 日期行 | `^[A-Z][a-z]+ \d+, \d{4}` 或纯中文日期 | 跳过 |
| 信头地址（Kiewit Plaza 等） | 纯英文短行，无中文对应 | 跳过或附加至下一 chunk |
| 签名行（Warren E. Buffett / Chairman） | 末尾几行 | 附加至最后一个 chunk 的 en_text/zh_text |
| 表格行（含 `\|`） | `\|` 分隔 | 单独成 chunk，`skip_embedding: true` |
| `[^*]:` 脚注定义 | `^\[\^\*\]:` | 附加至含 `[^*]` 引用的 chunk |

#### Chunk 数据结构示例

```json
{
  "chunk_id": "shareholder_1989_12",
  "source": "1989_Letter_to_Berkshire_Shareholders.md",
  "corpus": "shareholder",
  "year": 1989,
  "date": null,
  "letter_type": "shareholder_letter",
  "section_en": "Non-Insurance Operations > See's Candies",
  "section_zh": "非保险经营 > 喜诗糖果店",
  "chunk_index": 12,
  "en_text": "See's Candies had a record year in 1989...",
  "zh_text": "喜诗糖果1989年创下历史记录……",
  "skip_embedding": false
}
```

Partnership 信件额外有 `date` 字段（`YYYYMMDD`）：

```json
{
  "chunk_id": "partnership_19680124_8",
  "source": "19680124_Letter_RR.md",
  "corpus": "partnership",
  "year": 1968,
  "date": "19680124",
  "letter_type": "partnership_letter",
  "section_en": "Our Performance in 1967",
  "section_zh": "1967 年业绩",
  "chunk_index": 8,
  "en_text": "By most standards, we had a good year in 1967...",
  "zh_text": "按照大多数标准衡量，我们 1967 年的业绩都相当好……",
  "skip_embedding": false
}
```

#### 边界情况处理

| 文件 | 情况 | 处理方式 |
|------|------|---------|
| `1965` | 无章节标题 | `section = null` |
| `2000` | 含 `[^*]` 脚注 | 脚注附加至引用 chunk |
| `2023` | 芒格纪念章节开头 | 正常切分 |
| Partnership `195802` | 信头地址行（Kiewit Plaza） | 跳过 |

### 阅读展示

- 直接渲染 `Source.contentMd`，用 `react-markdown` + `remark-gfm`
- 中英交替显示（原始 markdown 格式）
- 支持单语过滤（EN / 中文模式：渲染时按段落语言过滤）
- 有视频的内容类型，阅读页顶部嵌入视频播放器

**三种阅读模式：**

| 模式 | 展示字段 | 章节标题 |
|------|---------|---------|
| 中文 | `zh_text` | `section_zh` |
| 英文 | `en_text` | `section_en` |
| 双语对照 | `en_text` + `zh_text` 并列 | `section_en` + `section_zh` |

---

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

---

## 检索系统（v2）

当前阶段对话检索范围**只包含股东信 + 合伙人信**：

```
Source.type IN ('shareholder', 'partnership')
```

股东大会、采访、文章继续保留阅读能力，但不进入对话检索主链路，等 v2 稳定后再扩容。

### 架构决策

| # | 决策 | 理由 |
|---|------|------|
| D1 | 不再使用"单点路由二选一" | LLM 不负责决定只跑关键词或只跑语义；单点路由选错一次就全错，并行多路召回更稳健 |
| D2 | Query Understanding 结构化输出 | 多轮追问、口语表达先归一化再检索；检索与生成解耦，定位问题更容易 |
| D3 | 并行召回 + 融合重排 | 关键词擅长实体精确命中，向量擅长语义扩展；融合后对 query phrasing 变化更鲁棒 |
| D4 | 只对英文建索引 | `searchVector` 与 `embedding` 都基于 `contentEn`；中文问题先做英文化检索表达 |
| D5 | 全部在 PostgreSQL 内完成 | tsvector + GIN、pgvector + HNSW，不引入外部检索引擎 |
| D6 | 引用精度升级为"段落级摘取" | 在 chunk 内做 query-aware passage 抽取，比固定截取前 N 字符更精准；用户点击引用时更容易验证答案 |

### Query Understanding 结构化输出（D2 细节）

LLM 把用户问题解析为统一 JSON：
- `task_type`：`fact` / `method` / `chat`
- `temporal_mode`（boolean）、`year_from` / `year_to`
- `entities`：公司、人名、事件
- `keyword_query`（精确召回）
- `semantic_query`（语义召回）
- `confidence`

MVP 延后字段：complex `themes`、complex `evidence_target`。

### 意图识别（简化版）

**3 种主任务类型：**

| 类型 | 说明 | 典型 query |
|------|------|-----------|
| `fact` | 事实/时间线查询 | "你最早哪年提到 GEICO？" |
| `method` | 原则/方法/演变 | "你如何定义护城河？" |
| `chat` | 闲聊/随机对话 | "你会给投资新手什么建议？" |

**2 种辅助模式：**
- `timeline`（boolean）：强制年份排序 + 扩大检索池
- `compare`（boolean）：要求双侧覆盖

### 召回策略（混合检索）

**三种查询意图对应路径：**

| 查询意图 | 路径 | 核心保证 |
|---------|------|---------|
| **实体/关键词**（公司名、人名、年份） | 关键词全扫 | 100% 召回，不遗漏 |
| **概念/观点**（护城河、定价权） | 向量语义检索 top-N | 相关性最优 |
| **混合**（巴菲特如何看喜诗糖果定价权） | 关键词定位 + 向量重排 | 完整 + 相关 |

**按 task_type 的检索权重：**

| task_type | 策略 |
|-----------|------|
| `fact` | 关键词为主，语义为 fallback/补充 |
| `method` | 关键词 + 语义均衡，语义略占优 |
| `chat` | 最少检索或不检索 |
| `timeline` 模式开启时 | 强制年份约束 + 扩大检索池 |

#### 关键词全扫（精确召回）

用于"哪些年提到 X"、"所有关于 Y 的段落"等聚合类查询：

```sql
SELECT * FROM chunks
WHERE (zh_text ILIKE '%喜诗糖果%' OR en_text ILIKE '%See''s Candies%')
  AND skip_embedding = FALSE
ORDER BY year, chunk_index;
```

**双语同时匹配**：同一实体用中英文各搜一遍，UNION 去重。

#### 语义检索

```sql
SELECT chunk_id, year, section_en, zh_text, en_text,
       1 - (embedding <=> $query_vector) AS score
FROM chunks
WHERE skip_embedding = FALSE
ORDER BY embedding <=> $query_vector
LIMIT 20;
```

#### 融合重排（RRF）

关键词结果 + 向量结果各自排序，用 Reciprocal Rank Fusion 合并：

```python
def rrf(keyword_results, vector_results, k=60):
    scores = {}
    for rank, chunk_id in enumerate(keyword_results):
        scores[chunk_id] = scores.get(chunk_id, 0) + 1 / (k + rank + 1)
    for rank, chunk_id in enumerate(vector_results):
        scores[chunk_id] = scores.get(chunk_id, 0) + 1 / (k + rank + 1)
    return sorted(scores, key=scores.get, reverse=True)
```

**两条 hard post-filter：**
1. 年份范围过滤
2. timeline 模式：年份去重 + 升序排列

**compare 模式：** 只强制最低双侧覆盖，MVP 不上重排序器。

#### 聚合类查询

"巴菲特在哪些年提到喜诗糖果" → 关键词全扫返回所有命中 chunk → LLM 汇总年份列表。**不走向量检索**（top-N 截断无法保证完整性）。

---

## 生成机制（Evidence-first）

**方案**：先证据规划，再生成回答。

1. 从融合候选中选出证据集合（覆盖实体/年份/子问题）
2. 形成内部 evidence plan（不对用户展示）
3. LLM 严格基于证据生成中文回答
4. 若证据不足，明确告知"未检索到足够原文"

**按 task_type 的生成规则：**

| task_type | 生成策略 |
|-----------|---------|
| `fact` | 先给结论，再用证据支撑 |
| `method` | 先给原则，再给实操方法 |
| `chat` | 简短对话式回应 |

全局约束：不支持的断言不生成；证据不足时先明确说明；低 temperature 保稳定性。

---

## 检索流程（v2）

```
用户提问
  │
  ├─① Query Understanding（结构化）
  │    输出 task_type/entities/time/keyword_query/semantic_query
  │
  ├─② 并行召回（限定 shareholder + partnership）
  │    ├─ 关键词路：tsvector top-k
  │    └─ 语义路：pgvector top-k
  │
  ├─③ 融合重排 + 去重（RRF + hard post-filter）
  │
  ├─④ 段落级证据抽取（query-aware passage）
  │
  └─⑤ Evidence-first 生成回答 + 返回来源
```

---

## Embedding 方案

- **模型**：火山引擎多模态 embedding API（`ep-20260322020312-4xfnx`），doubao `text-embedding-v3`
- **维度**：1024，HNSW 索引
- **向量化字段**：`zh_text`（仅中文，跨语言匹配能力覆盖英文 query）
- **跳过**：`skip_embedding = true` 的表格 chunk 不向量化
- **批处理**：每批 50 个 chunk，避免 API 超时
- **生成方式**：一次性脚本跑全量，新数据增量生成
- **API 配置**：`EMBEDDING_API_KEY` / `EMBEDDING_API_BASE_URL` / `EMBEDDING_MODEL`

---

## 评测 Benchmark（MVP 30题）

用于验证检索质量，按以下权重评分：
- Facts Retrieval：60%
- Principles/Methods：30%
- Random Chat：10%

**Release Gate（MVP）：**
1. Fact 性能不低于 baseline
2. 平均延迟不超过 baseline +20%
3. 证据不足行为人工校验（无幻觉生成）

### A. Facts Retrieval（10 题）

1. 你最早在哪一年提到 GEICO？
2. 你最早什么时候明确讨论可口可乐投资？
3. 你在哪些年份重点谈过股票回购（share buyback）？
4. 你在哪一年正式收购了 BNSF？当时你怎么描述这笔交易？
5. 你在哪些年份详细解释过保险浮存金（float）？
6. 你最早哪一年公开承认过 IBM 投资失误？
7. 你在哪一年首次系统阐述"伯克希尔不会分红"的立场？
8. 你在哪些年份集中讨论过继任与管理层接班问题？
9. 你最早在哪一年提到对苹果的持仓逻辑？
10. 在 2008-2009 金融危机阶段，你在信里重点说了哪些具体动作？

### B. Principles / Methods / Evolution（10 题）

1. 你如何定义"能力圈（circle of competence）"？
2. 你怎么判断一家公司有没有"护城河（moat）"？
3. 你如何在"好公司合理价"和"普通公司便宜价"之间取舍？
4. 你对杠杆（leverage）的态度是什么？哪些情况绝不碰？
5. 你如何评估管理层的诚信、能力与股东导向？
6. 你如何看待市场择时（market timing）？
7. 你在资本配置上如何权衡回购、并购和持有现金？
8. 你对"分散投资 vs 集中投资"的观点是怎样的？
9. 你关于科技公司投资的态度，这些年发生了哪些变化？
10. 你如何把"安全边际"落实到实际买入决策里？

### C. Random Chat（10 题）

1. 如果我今天只能记住一句你的投资建议，你会选哪句？
2. 你现在还会每天读很多年报吗？怎么安排阅读节奏？
3. 芒格对你影响最大的一条思维习惯是什么？
4. 如果我是投资新手，你会让我先改掉哪三个坏习惯？
5. 你觉得普通人最容易误解你的哪条观点？
6. 面对连续下跌的市场，你会怎么让自己保持冷静？
7. 你会怎么向完全不懂投资的人解释"复利"？
8. 如果我总想追热门题材，你会怎么劝我？
9. 你今天还会建议年轻人长期持有指数基金吗？
10. 除了投资，你觉得一个人长期成功最重要的品质是什么？

---

## 迭代方法论（Benchmark-Driven）

### 标准循环（必须遵守）

1. 确认 baseline commit 和 baseline summary 文件
2. 只实施一个聚焦优化（单变量优先）
3. 运行：`npm run eval:mvp:benchmark`
4. 对比：`npm run eval:mvp:compare -- --base <baseline_summary> --candidate tests/evals/mvp_benchmark_30_summary.json`
5. 决策：指标实质改善且通过 gate → keep + commit；无实质改善或关键指标退步 → rollback
6. 归档 summary/results 至 `tests/evals/history/`

### Keep / Rollback 规则

**Keep 条件（全部满足）：**
1. `fact.avgHits` 不低于对比 baseline
2. `avgLatencyMsAll` ≤ +20% vs baseline
3. weighted score 有实质提升，或 fact zero-hit 明显改善
4. 人工校验确认幻觉没有增加

**Rollback 条件（任一满足）：**
1. `fact.avgHits` 低于上一个 kept round
2. weighted score 退步且无 fact 质量补偿
3. 延迟变差且无明显检索收益

### 迭代日志（2026-03-24）

Baseline：commit `fe74056`，summary `tests/evals/history/mvp_benchmark_30_summary_2026-03-24T12-43-59.080Z.json`

| Round | 状态 | Commit | 变更 | 结果 |
|-------|------|--------|------|------|
| A | ✅ kept | `eec2cd6` | strict token filter fix + keyword anchor enrichment + compare script | weightedAvgHits `6.11→6.85`，fact.avgHits `6.1→7.4`，latency `+2.11%` |
| B | ❌ rollback | — | broader strict token relaxation + extra anchors | weighted/fact 退步 |
| C | ❌ rollback | — | entity synonym rewrite only | 强退步（weighted 和 fact 均下降） |
| D | ✅ kept（当前最优） | `76a69ce` | `mention + timeline` 中保留 semantic fallback（`semanticLimit >= 8`）而非强制 `0` | weightedAvgHits `6.85→7.54`，fact.avgHits `7.4→8.0`，fact.zeroHitCount `2→0`，latency `+4.45%` |

**当前推荐下一目标：** 修复意图误分类——投资方法类问题（`M006`、`M009`）被错误归入 `chat`。

---

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

---

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

---

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

---

## 社区与 UGC（Post-MVP）

### 产品定位

在"读信/对话"的核心体验之上，构建**用户生成内容层**：用户把从 Buffett 原文中获得的洞察、以及自己看好的投资标的公开分享，形成"Buffett 框架驱动的价值投资社区"。

飞轮逻辑：

```
读信/对话（核心体验）
  ↓
用户产出洞察/标的分析（UGC）
  ↓
内容公开展示，吸引新用户（SEO + 社交传播）
  ↓
付费用户发布 + 订阅机制（变现）
  ↓
优质内容吸引更多人读信/对话
```

---

### 功能 1：洞察卡（Buffett Insight Card）

**用户在读完信件或与 Buffett 对话后，将自己的理解和解读公开分享。**

#### 内容形态

```
┌─────────────────────────────────────────┐
│  📌 用户写的洞察/解读（100-500 字）        │
│                                         │
│  ── 引自 Buffett 原文 ──────────────────  │
│  "See's Candies had a record year..."   │
│  1989年股东信 · Non-Insurance Operations  │
│                                         │
│  作者：@用户名  ·  2026-03-28            │
└─────────────────────────────────────────┘
```

- 必须关联至少一个 Chunk（从你们数据库中选，不能凭空写）
- 关联方式：对话中点击"保存洞察" → 自动带入当前引用的 chunk
- 支持生成分享图片（适合微信朋友圈/Twitter 传播）

#### 数据模型

```
Insight（洞察卡）
├── id
├── userId           -- 作者
├── content          -- 用户写的洞察（100-500 字）
├── chunkIds         -- 关联的 chunk ID 列表（1-3 个）
├── sourceIds        -- 冗余：关联的 Source（年份/类型展示用）
├── visibility       -- 'public' | 'private'
├── likeCount
├── createdAt
└── updatedAt
```

---

### 功能 2：投资标的分析（Investment Thesis）

**用户发布自己看好的投资标的，必须用 Buffett 原文作为分析框架依据。**

#### 核心设计：强制引用原文

随便喊单的质量门槛问题通过"必须引用 Buffett 原文"解决：

```
用户发布一个标的想法
  └─ 标的名称（如 $BRK.B、比亚迪、茅台）
  └─ 投资逻辑（用户自己写，200-1000字）
  └─ Buffett 原文引用（必填，来自你们数据库）
      例：引用 1987年股东信 "护城河" 段落
          → "正如 Buffett 在 1987 年信中所说..."
  └─ 免责声明（强制展示：本内容为个人学习交流，不构成投资建议）
```

**好处：**
- 内容天然与平台核心数据绑定，差异化明显（Seeking Alpha / 雪球没有这个）
- 发帖必须先读原文，倒逼用户使用核心功能
- 质量筛选：无法引用 Buffett 原文支撑的标的观点，说不通

#### 数据模型

```
InvestmentThesis（标的分析）
├── id
├── userId           -- 作者
├── ticker           -- 标的代码（如 "BRK.B"、"600519"）
├── name             -- 标的名称（如 "伯克希尔·哈撒韦"）
├── market           -- 'US' | 'HK' | 'A'
├── thesis           -- 投资逻辑（200-1000字）
├── chunkIds         -- 必填，关联的 Buffett 原文 chunk（1-5 个）
├── stance           -- 'bullish' | 'watchlist'
├── visibility       -- 'public' | 'private'
├── likeCount
├── createdAt
└── updatedAt
```

---

### 功能 3：展示墙 + 订阅

#### 展示墙（/community）

```
┌──────────────────────────────────────────────┐
│  [最新洞察]  [热门标的]  [关注的人]            │
├──────────────────────────────────────────────┤
│  洞察卡 1                                     │
│  标的分析 1  $BRK.B  @用户名  👍 23           │
│  洞察卡 2                                     │
│  ...                                          │
└──────────────────────────────────────────────┘
```

- 免费用户：可浏览全部公开内容，看摘要（前 50 字 + 引用章节名）
- 付费用户：看完整内容 + 发布权限 + 订阅其他用户

#### 订阅机制

- 付费用户可以关注其他用户
- 关注后：对方发布新内容时收到通知（站内消息，MVP 阶段不做邮件）
- **不做用户间付费订阅**（法规复杂，MVP 阶段只做平台级订阅）

---

### 权限矩阵

| 动作 | 未注册 | 免费用户 | 付费会员 |
|------|:------:|:-------:|:-------:|
| 浏览展示墙（摘要） | ✅ | ✅ | ✅ |
| 查看完整洞察/分析 | ❌ | ❌ | ✅ |
| 发布洞察卡 | ❌ | ❌ | ✅ |
| 发布标的分析 | ❌ | ❌ | ✅ |
| 关注用户 | ❌ | ❌ | ✅ |
| 对话（核心功能） | ❌ | 30次/天 | 无限制 |

> 「查看完整内容需付费」是核心转化钩子：用户在展示墙看到感兴趣的分析，点进去发现需要订阅。

---

### 合规设计

| 风险 | 处理方式 |
|------|---------|
| 投资建议监管 | 所有标的分析页面强制展示免责声明："本内容为个人投资学习交流，不构成投资建议，据此操作风险自担" |
| 用户发布违规内容 | 举报机制 + 管理员删除权限，MVP 阶段人工审核 |
| 平台定位 | 明确为"价值投资学习社区"，不做实时行情、不做荐股推送 |

---

### 设计决策

| # | 决策 | 理由 |
|---|------|------|
| D21 | 标的分析必须引用 Buffett 原文 | 质量门槛 + 差异化；逼用户用核心功能；无法引用则说明逻辑不通 |
| D22 | 免费看摘要、付费看全文 | 展示墙作为付费转化入口，内容可见才有转化动力 |
| D23 | MVP 不做用户间付费订阅 | 监管复杂（内容付费资质）；平台级订阅已足够验证变现意愿 |
| D24 | 不做实时行情/价格 | 避免成为荐股平台，维持"学习社区"定位 |
| D25 | 洞察卡支持生成分享图片 | 微信朋友圈/Twitter 是主要传播渠道，图片比链接传播效率高 |

---

## 标的纵向叙事（Investment Target Longitudinal Narrative）

> 状态：🔲 设计中（Post-MVP）
> 别名：Stock Story / 三层叠加图
> 引入时间：2026-04-11

### 目标场景

用户输入或点击一只标的（如 IBM、KO、AAPL），获得一个 **单页可视化**：把这只股票在 Buffett 60 年公开记录里的全部叙事 + 公司基本面真实数据 + 同期其他价值投资大师的持仓行为，**叠加在同一时间轴上**呈现。

**用户价值**：

- 不是问答，是「**带时间维度的纵向叙事**」—— 一个可信的、按时间排序的、每段都能点回原文的投资案例研究
- 三种数据源相互印证（叙事 ⇌ 基本面 ⇌ 聪明钱），最大限度降低幻觉空间
- 天然适合截图分享 → 给社区 UGC 功能 2「投资标的分析」提供高质量素材

**典型问句**：

- 「巴菲特怎么看 IBM？为什么先重仓再清仓？」
- 「KO 这 35 年他态度有变化吗？」
- 「Apple 这只他自己说不投科技股的标的，是怎么变成第一重仓的？」

### 核心设计：三层数据 × 同一时间轴

```
                    Lane A：基本面
   营收 / FCF / EPS  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                                                         (EDGAR 10-K/Q)

                    Lane B：聪明钱矩阵
   Buffett    ░░▓▓▓▓▓▓▓▓▓▓▓▓░░░░          ← 持仓占比色深
   Klarman      ░░░░▓▓░░░░░░             ← 谁先进
   Watsa             ▓▓▓▓▓▓▓▓░░          ← 谁先撤
   Pabrai                ░░▓▓░░          (13F)
   ...

                    Lane C：叙事图钉
        📍2011  📍2013  📍2016 (沉默)  📍2017  📍2018
        买入    重申     —              清仓     反思
                                                         (Buffett 信件 mentions)
```

**为什么这个形态最强**：

1. 价格图是大家熟悉的视觉语言，降低门槛
2. 图钉密度本身就是信息量 —— 哪几年频繁提及 vs 沉默，沉默也是叙事
3. 真实市场数据 + 真实 13F + 真实原文，三源交叉验证，最低幻觉空间
4. 单页设计天然适合分享

### 数据架构：多源情报融合

#### 三层模型

```
                  叙事层（Narrative）
              Buffett 信件 / 大会 / 访谈
              抽实体 + 情感 + 时间锚点
                       │
                       ▼
   ┌─────────────┐  ┌─────────┐  ┌─────────────┐
   │  基本面层    │  │ 实体核心 │  │  聪明钱层    │
   │  EDGAR      │◀─│ entities │─▶│  13F        │
   │  10-K/Q XBRL │  │ relations│  │  Dataroma   │
   │             │  │          │  │   名单      │
   └─────────────┘  └─────────┘  └─────────────┘
```

`entities.cik` 是关键锚点 —— EDGAR / 13F / 信件提及全部用 SEC CIK 做唯一标识，避免 "IBM" / "International Business Machines" / "IBM Corp" 实体重复。

#### Postgres Schema 新增

```sql
-- 1. 实体核心表（公司、人物、概念）
entities (
  id              text primary key,         -- cuid
  type            text not null,            -- 'company' | 'person' | 'concept'
  canonical_name  text not null,
  aliases         text[],
  cik             text unique,              -- SEC CIK，公司用
  ticker          text,
  sector          text,
  metadata        jsonb,
  created_at      timestamptz default now()
)
create index on entities (type);
create index on entities (ticker);

-- 2. 来源表（统一登记所有外部数据来源，与已有 Source 解耦）
ext_sources (
  id              text primary key,
  kind            text not null,            -- '10k' | '10q' | '13f' | 'xbrl' | 'price'
  url             text,
  ts              timestamptz,              -- 来源本身的时间（报告期末、13F as_of）
  filer_entity_id text references entities(id),  -- 谁出的（13F filer）
  metadata        jsonb,
  created_at      timestamptz default now()
)
create index on ext_sources (kind, ts);

-- 3. 提及表（叙事层产出，从已有 chunks 抽取）
mentions (
  id              text primary key,
  entity_id       text references entities(id) not null,
  chunk_id        text references chunks(id) not null,  -- 链回已有 chunks
  ts              timestamptz,              -- 提及时间（来自 chunk.source.year/date）
  sentiment       text,                     -- 'bullish' | 'neutral' | 'cautious' | 'critical'
  sentiment_score real,                     -- -1.0 ~ 1.0
  span            text,                     -- 高亮片段（限长，全文走 chunks）
  metadata        jsonb,
  created_at      timestamptz default now()
)
create index on mentions (entity_id, ts);
create index on mentions (chunk_id);

-- 4. 财务数据表（EDGAR XBRL 产出）
financials (
  id              text primary key,
  entity_id       text references entities(id) not null,
  source_id       text references ext_sources(id) not null,
  period_end      date not null,
  period_type     text not null,            -- 'FY' | 'Q1' | 'Q2' | 'Q3' | 'Q4'
  line_item       text not null,            -- 'Revenue' | 'FreeCashFlow' | 'EPS' | ... 规范化
  value           numeric,
  unit            text,                     -- 'USD' | 'shares' | ...
  raw_xbrl_tag    text,                     -- 原始 XBRL tag，便于追溯
  created_at      timestamptz default now(),
  unique (entity_id, period_end, period_type, line_item)
)
create index on financials (entity_id, period_end);

-- 5. 持仓表（13F 产出）
holdings (
  id                   text primary key,
  holder_entity_id     text references entities(id) not null,  -- 投资人/机构
  security_entity_id   text references entities(id) not null,  -- 被持有的公司
  source_id            text references ext_sources(id) not null,
  as_of_date           date not null,                          -- 季末
  shares               bigint,
  value_usd            bigint,
  percent_of_portfolio real,
  is_new_position      boolean,                                -- 本季首次出现
  is_sold_out          boolean,                                -- 本季清仓
  position_change_pct  real,                                   -- 环比变化
  created_at           timestamptz default now(),
  unique (holder_entity_id, security_entity_id, as_of_date)
)
create index on holdings (security_entity_id, as_of_date);
create index on holdings (holder_entity_id, as_of_date);

-- 6. 关系表（实体间语义关系，spike 阶段先建 schema 不必填充）
relations (
  id                 text primary key,
  src_entity_id      text references entities(id) not null,
  dst_entity_id      text references entities(id) not null,
  type               text not null,         -- 'owns' | 'manages' | 'mentions' | 'related_to'
  ts                 timestamptz,
  evidence_chunk_id  text references chunks(id),
  confidence         real,
  metadata           jsonb,
  created_at         timestamptz default now()
)
create index on relations (src_entity_id, type);
create index on relations (dst_entity_id, type);
```

**与现有 schema 的关系**：

- `mentions.chunk_id` 链回已有的 `chunks` 表 —— 复用已经做好的 doubao 1024-dim 切分和向量化，**不重复存全文**
- 新增表用 `ext_sources` 命名，避免与已有 `Source`（信件/大会等内部内容）混淆
- `entities.id` 用 cuid，与现有 Source / chunks 一致
- 完全不动现有的 `Source` / `chunks` / `ChatMessage` 表

### ETL Sidecar：Python on 阿里云

#### 为什么 Python

- `edgartools` 是 OSS 里 EDGAR / 13F 解析 DX 最好的库（XBRL tag 规范化、13F informationtable XML 解析、CIK 映射全包了）
- TypeScript 生态没有同等质量的库，自己写 13F XML parser 至少多 300 行
- ETL 是 batch job，与 Next.js 完全解耦：**Python 只写 Postgres，Next.js 只读**

#### 部署形态

```
阿里云轻量服务器 (relay.air7.fun 同机)
├─ /root/asr-proxy            ← 已有：ASR relay (pm2)
└─ /root/etl                  ← 新增
   ├─ requirements.txt        ← edgartools / yfinance / psycopg / pydantic / pyyaml
   ├─ legends.yaml            ← 价值投资人 CIK 静态名单
   ├─ db.py                   ← 共用 Postgres 写入（DATABASE_URL 环境变量）
   ├─ pull_edgar.py           ← 拉 10-K/Q XBRL → financials
   ├─ pull_13f.py             ← 拉 13F → holdings
   ├─ pull_mentions.py        ← 跑 LLM 抽实体（读 chunks，写 mentions）
   ├─ pull_prices.py          ← 拉 yfinance → 单独 prices 表（可选）
   └─ .env                    ← DATABASE_URL / OPENAI_API_KEY
```

#### 调度

- Spike：手动跑 `python pull_edgar.py --cik 0000051143`（IBM）
- 长期：crontab 每周一次 incremental（13F 季度更新，10-K/Q 按需）

#### SEC User-Agent（强制要求）

```python
from edgar import set_identity
set_identity("Rafael walkklaw@gmail.com")
```

不设会被 SEC throttle/封 IP。

### 数据源清单

| 数据 | 来源 | 工具 | 备注 |
|------|------|------|------|
| 公司财报 | EDGAR XBRL `companyfacts` | edgartools | 完全免费，CIK 是主键 |
| 13F 持仓 | EDGAR `informationtable` | edgartools | 美股多头 only，45 天延迟 |
| 价值投资人名单 | Dataroma | **静态 config**（不爬） | 一次性手抄 ~10 人 CIK 进 legends.yaml |
| 股价历史 | Yahoo Finance | yfinance | 非官方爬 Yahoo，足够 spike，fallback Stooq |
| Buffett 信件实体 | 已有 chunks 表 | OpenAI / doubao API | 一次性 LLM 抽取 |

### Caveats（必须 heads-up）

1. **13F 是不完整画像** —— 只有美股多头，没空头、债券、海外。Pabrai 现在重仓印度，13F 看不到
2. **45 天披露延迟** —— 看不到当季实时
3. **Berkshire ≠ Buffett** —— 13F filer 是机构。归因到「人」需要在 entities 层做 mapping（Berkshire entity 加 `metadata.thinker = "Warren Buffett"`）
4. **EDGAR XBRL tag 不统一** —— 同一概念不同公司用不同 tag。IBM 这种大公司还行，小盘股要做规范化映射表（先做白名单：Revenue / NetIncome / FreeCashFlow / EPSDiluted / TotalAssets / OperatingCashFlow）
5. **yfinance 不稳定** —— Yahoo 偶尔改 schema，需要 fallback
6. **股价 ≠ 投资逻辑** —— 视觉以股价为主线易让用户误以为是「跟着大师抄底」推荐，**必须**强制展示免责声明（沿用 D21）

### 价值投资人首批名单（legends.yaml）

首批 5 人，覆盖中美差异化风格 + 视觉对比。后续按用户反馈和数据质量再扩。

| # | 名字 | Filer 机构 | 风格 | 13F 覆盖度 |
|---|------|----------|------|----------|
| 1 | Warren Buffett | Berkshire Hathaway | 长期集中持有 | 完整（核心持仓全在美股） |
| 2 | Seth Klarman | Baupost Group | 深度价值 + 现金灵活 | 完整 |
| 3 | Mohnish Pabrai | Pabrai Investment Funds | 单一押注 | ⚠️ 不全（重仓印度，13F 看不到） |
| 4 | 李录 (Li Lu) | Himalaya Capital | 长期集中 + 中概 | ⚠️ 不全（BYD 等港股看不到，仅美股部分） |
| 5 | 段永平 (Duan Yongping) | H&H International Investment | 长期集中 + 反向 | ⚠️ 不全（茅台/网易等 A 港股看不到，仅美股部分） |

> CIK 在 spike 时 edgartools 一次性查回写入 yaml，不在文档里写死。

**Chinese / 跨市场投资人的特殊处理（D36）**：

- 李录、段永平、Pabrai 的 13F **只反映美股长仓**，他们最知名的非美持仓（BYD、茅台、印度 IT 股等）完全看不到
- UI 上每张投资人卡片必须标注「🇺🇸 仅美股长仓」徽章
- 未来扩展（Phase 3+）：可考虑接 HKEX DI（港股披露权益）和 A 股龙虎榜，把 13F 升级成「全球持仓视图」

### Spike 路径：IBM First

**为什么 IBM 优先**：失败案例戏剧张力强，「先进先撤」在聪明钱矩阵上视觉冲击最大。Buffett 2011 买入、2017–18 清仓的时间线极适合 demo，且数据范围（10 年）适中，KO 的 35 年数据量过大不利于首次验证。

#### Phase 1：数据 ETL（Python，预计 3–5 天）

```
1. 阿里云 /root/etl 初始化（venv + requirements.txt）
2. Prisma migration 加 6 张新表（应用到同一 Supabase Postgres）
3. legends.yaml 抄 10 人，跑 pull_13f.py 一次性回填 CIK
4. pull_edgar.py: 拉 IBM 10-K 历年 Revenue/FCF/EPS/EPSDiluted → financials
5. pull_13f.py: 拉 legends 全部 13F → 过滤 IBM → holdings
6. pull_mentions.py: 在已有 chunks 里 LLM 抽 IBM 提及 → mentions（含 sentiment）
7. SQL 自检：
   - select count(*) from financials where entity_id='IBM'
   - select * from holdings where security_entity_id='IBM' order by as_of_date
   - select * from mentions where entity_id='IBM' order by ts
```

#### Phase 2：前端可视化（TypeScript，预计 5–7 天）

```
1. /api/stock/[ticker] route：聚合三层数据返回 JSON
2. /stock/[ticker] 页面（visx + framer-motion）
3. Lane A：财务折线（Revenue + FCF + EPS 三条）
4. Lane B：聪明钱矩阵热力（x=季度，y=投资人，色深=持仓占比）
5. Lane C：叙事图钉 + click → 弹出原文 chunk + 链接到信件阅读页
6. 顶部 hero：AI 生成的 3 句话「叙事弧」
7. 底部强制免责声明（沿用 D21）
```

#### Phase 3：扩展（按需）

- 加 KO / AAPL / AXP / GEICO / WFC / BAC
- 分享卡片（截图友好 UI，参考 D25 洞察卡分享图）
- 接入社区 UGC 功能 2：在「投资标的分析」发帖时一键引用本页 mentions

### 设计决策

| # | 决策 | 理由 |
|---|------|------|
| D26 | 用 SEC CIK 做实体主键 | 唯一权威标识；跨 EDGAR / 13F / 信件统一锚点；避免命名重复 |
| D27 | Python ETL sidecar，TypeScript 前端 | edgartools 是 OSS 里 EDGAR/13F 最好的库；纯 TS 自己写代价大 |
| D28 | ETL 跑在阿里云 relay 同机 | 避免新增基础设施；和 ASR relay 同一台 cron 即可 |
| D29 | Dataroma 当静态名单，不爬 | 它的价值是策展元数据，源数据都在 EDGAR；爬站脆弱无必要 |
| D30 | mentions 表 chunk_id 链回 chunks | 复用现有 doubao 1024-dim 向量和切分，不冗余存全文 |
| D31 | 强制显示免责声明 | 视觉以股价为主线易误导为「抄底推荐」；沿用 D21 合规设计 |
| D32 | IBM 优先 spike，不是 KO | 失败案例 + 「先进先撤」叙事 + 数据范围适中（10 年） |
| D33 | 13F caveats 在 UI 显式标注 | 美股多头 only / 45 天延迟，避免用户误解为完整持仓 |
| D34 | 新增表用 ext_sources 命名 | 避免与已有 Source（信件/大会）混淆 |
| D35 | XBRL 先做白名单规范化 | 全量映射成本高；先 6 个核心科目（Revenue / NetIncome / FCF / EPS / TotalAssets / OperatingCF） |
| D36 | 跨市场投资人 UI 显式标注 | 李录/段永平/Pabrai 的 13F 只覆盖美股长仓，必须标徽章避免误解；未来 Phase 3+ 接 HKEX DI / A 股龙虎榜补全 |

### 与现有功能的关系

- **复用**：`chunks` 表 + doubao 向量 + Source schema + 阅读页跳转
- **支撑**：社区 UGC 功能 2「投资标的分析」可一键引用本页 mentions 作为原文支撑
- **不影响**：现有对话 / 检索 / 阅读功能完全独立，新功能只在 Postgres 加表 + 加新页面

---

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

---

## 迁移兼容性

| 环境 | tsvector + GIN | pgvector + HNSW | 迁移成本 |
|------|:-:|:-:|------|
| Supabase（当前） | 内置 | 内置扩展 | — |
| 阿里云 RDS PostgreSQL | 内置 | 支持（PG ≥ 14） | 换 DATABASE_URL |

---

## 基础设施状态

| 层 | 当前 | 未来（按需） |
|---|---|---|
| 数据库 | ✅ Supabase PostgreSQL 新加坡 | 阿里云 RDS |
| 认证 | ✅ NextAuth Credentials | 手机号 + 阿里云短信 |
| 限流 | ✅ Upstash Redis 新加坡 | — |
| 支付 | 🆕 LemonSqueezy（MVP） | Ping++（微信/支付宝，需营业执照） |
| 行为追踪 | 🆕 PostHog Cloud | PostHog 自托管 |
| 日志监控 | 未接入 | Vercel Analytics + Sentry |

---

## NOT in scope（明确延后）

| 事项 | 理由 |
|------|------|
| 自训练虚拟人模型 | API 方案足够，自训练 ROI 不高 |
| 微信登录 | 需要公众号资质，个人开发者暂时做不了 |
| Ping++ 支付 | 需要营业执照，MVP 阶段用 LemonSqueezy |
| Fine-tune 模型 | RAG 方案已满足需求，fine-tune 是优化项 |
| 通用 RAG 平台 | 基础设施竞争无优势，专注领域内容质量 |

---

## 实施优先级

### 当前阶段：知识服务化（v0.30+）

目标：把现有 Buffett 数据能力封装为可访问的知识服务，验证 B2B API 付费意愿。

```
Phase G：知识图谱 v2（多投资人 schema）              🔲 v0.30.0
  ├─ Neo4j schema 重新设计（Investor 节点，可扩展）
  ├─ LLM 批量提取 Buffett triplets（替代 keyword 匹配）
  ├─ Concept → Concept 关系（RELATES_TO、EVOLVES_TO）
  └─ 验证：graph_facts 工具返回有意义的结果

Phase H：MCP Server                                  🔲 v0.31.0
  ├─ MCP server 实现（semantic_search / graph_facts / full_text）
  ├─ Claude Code Skill 文件
  ├─ REST API tool schema（OpenAI-compatible）
  └─ 验证：Claude Desktop 可直接调用工具查询 Buffett

Phase I：Munger 模块                                 🔲 v0.32.0
  ├─ Munger 语料收集（Poor Charlie's Almanack / 演讲）
  ├─ 复用 Buffett 模块 pipeline 导入
  ├─ compare_investors 工具实现
  └─ 验证：schema 可扩展性得到验证
```

### MVP Chat（已完成阶段）— 找种子用户、验证付费意愿

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

Phase F：用户数据 + 支付                          🚧 v0.24.0（部分完成）
  ├─ ✅ PostHog 接入（pageview + session recording + 关键事件）
  ├─ ✅ ChatMessage 表 + 对话记录写入（question / answer / sourceIds / taskType）
  ├─ ✅ 对话评分（👍👎）→ PATCH /api/chat/[id]/rating
  ├─ ✅ 统一入口：删除 ChatPage，所有入口 → /chat（原 /workspace）
  ├─ 🔲 LemonSqueezy 订阅集成
  ├─ 🔲 订阅状态校验（免费 vs 会员的次数限制）
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

### Pipeline 实现顺序

1. **实现 `chunk_file(filepath) -> List[Chunk]`**
   - 用 `1984_Letter_to_Berkshire_Shareholders.md` 做单元测试（典型结构）
   - 验证：每封信约 30–100 个 chunk

2. **处理边界情况**（见上文切分策略边界情况表）

3. **批量处理**
   - Shareholder：63 个文件
   - Partnership：33 个文件

4. **向量化**：调用 doubao API，批量写入 `embedding` 列

5. **验证检索**
   - 关键词测试："喜诗糖果" 命中所有年份
   - 语义测试："what is intrinsic value" → 召回相关段落
   - 聚合测试："哪些年提到 GEICO" → 完整年份列表
