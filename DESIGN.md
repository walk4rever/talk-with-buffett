> 🔒 内部文件，不对外公开。

# 设计文档：数据与检索系统

> 最后更新：2026-03-22

## 数据架构

### 数据来源

巴菲特股东信 markdown 文件，来源 [pzponge/Yestoday](https://github.com/pzponge/Yestoday)。每个文件为中英文交替的完整 markdown，覆盖 1965-2024 全部 60 封信。

### 数据模型

```
Letter
├── year             -- 年份
├── title            -- 标题
├── contentMd        -- 完整 markdown（中英交替原文，原样保存）
└── chunks[]         -- 切分后的检索单元

Chunk（替代原 Section 表）
├── letterId         → Letter
├── order            -- 在信中的顺序
├── title            -- 章节标题（如 "Focus on the Forest"），可为空
├── contentEn        -- 英文段落
├── contentZh        -- 中文段落
├── embedding        -- vector(1024)，基于 contentEn
└── searchVector     -- tsvector，基于 contentEn
```

### 切分策略

1. 按 `#` / `##` 标题切分为章节
2. 无标题的早期信件（1965-1976 等）按段落切分
3. 超长章节按段落二次切分（上限 ~800 token）
4. 每个 chunk 内分离中英文：CJK 字符开头的段落为中文，否则为英文

### 阅读展示

- 直接渲染 `Letter.contentMd`，用 `react-markdown` + `remark-gfm`
- 中英交替显示（原始 markdown 格式）
- 支持单语过滤（EN / 中文模式：渲染时按段落语言过滤）
- 取消双栏模式，简化阅读体验

## 检索系统

### D1: 混合检索（Hybrid Search）

**方案**：关键词全文检索 + 向量语义检索，加权合并排序。

**理由**：两者互补——
- 关键词擅长精确匹配（"2008年 GEICO"）
- 向量擅长语义理解（"借钱炒股" → leverage/debt/margin）
- 单一方案都有盲区，混合检索覆盖最全

### D2: 只对英文建索引

**方案**：tsvector 和 embedding 都基于 `contentEn`，用户中文提问通过 AI 翻译成英文后检索。

**理由**：
- 英文是原文（source of truth），语义最准确
- 只维护一套索引，避免中文分词复杂性（Supabase 不支持 zhparser）
- 翻译步骤顺便做 query expansion（口语 → 检索友好表达）

### D3: 全部在 Supabase PostgreSQL 内完成

**方案**：tsvector + GIN（内置）、pgvector + HNSW（内置扩展），不引入外部搜索引擎或向量数据库。

**理由**：
- 数据量小（~500 chunks），PostgreSQL 完全能处理
- Supabase Free 方案即支持 pgvector
- 一条 SQL 同时跑两路检索，架构简单
- 迁移阿里云 RDS PostgreSQL 时零代码改动

### D4: 不使用图数据库

**理由**：数据是线性文档，不是图结构。SQL JOIN 足够。

### D5: 不做中文 embedding

**理由**：存储翻倍无必要，Query 翻译是更可控的方案。

### D6: 不使用 qmd 等外部 RAG 框架

**理由**：
- 数据极其规整（60 篇格式一致的 markdown），按标题切分即可
- qmd 是本地 CLI 工具（SQLite），我们是线上产品（PostgreSQL）
- 自己切分代码 ~50-80 行，完全可控，无需外部依赖

## 引用机制

**方案**：后端主导引用，AI 只做选择。

1. 检索返回 top-5 chunks，在 system prompt 中编号为 `[来源1]`..`[来源5]`
2. AI 在回答中自然标注 `[来源N]`
3. 后端提取编号 → 映射到实际 chunk 数据 → 生成 citations
4. Excerpt 从真实 `contentEn` 截取前 80 字符

**优点**：引用 100% 真实，不可能幻觉。

## 检索流程

```
用户中文提问
  │
  ├─① Query 翻译 + 改写（AI API，与 usage check 并行）
  │    "借钱炒股危险吗" → "dangers of leverage margin debt investing"
  │
  ├─② 并行两路检索
  │    ├─ 向量路：query embedding → cosine similarity → top 20
  │    └─ 关键词路：translated query → tsvector @@ plainto_tsquery → top 20
  │
  ├─③ 合并去重 + 加权排序
  │    score = 0.7 × vector_score + 0.3 × keyword_score
  │    取 top 5
  │
  └─④ 喂给巴菲特 persona 生成中文回答
```

## Embedding 方案

- **模型**：火山引擎多模态 embedding API（`ep-20260322020312-4xfnx`）
- **维度**：1024，HNSW 索引
- **生成方式**：一次性脚本跑全量（~500 chunks，1-2 分钟），新数据增量生成
- **API 配置**：`EMBEDDING_API_KEY` / `EMBEDDING_API_BASE_URL` / `EMBEDDING_MODEL`

## 迁移兼容性

| 环境 | tsvector + GIN | pgvector + HNSW | 迁移成本 |
|------|:-:|:-:|------|
| Supabase（当前） | 内置 | 内置扩展 | — |
| 阿里云 RDS PostgreSQL | 内置 | 支持（PG ≥ 14） | 换 DATABASE_URL |
