> 🔒 内部文件，不对外公开。

# 设计文档：检索系统

> 最后更新：2026-03-22

## 设计目标

让用户用自然语言（中文为主）提问，从 1965-2024 年巴菲特股东信中精准找到最相关的段落，支撑三个产品场景。

## 产品场景

| 场景 | 用户动作 | 检索要求 | 优先级 |
|------|----------|----------|--------|
| **对话 RAG** | 聊天框提问 | 语义理解 + 精确匹配，top 5 段落喂给 AI | P0 |
| **信件内搜索** | 阅读信件时搜索 | 前端子串匹配 + 高亮，不需要后端 | P0 |
| **全局探索** | Explore 页搜索公司/主题 | 复用 RAG 检索 + 按年份分组展示 | P1（Phase 2） |

## 架构决策

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
- 中文是翻译，质量不均匀，早期年份可能有瑕疵
- 只维护一套索引，避免中文分词的复杂性（Supabase 不支持 zhparser）
- 翻译步骤顺便做 query expansion（口语 → 检索友好表达）

### D3: 全部在 Supabase PostgreSQL 内完成

**方案**：tsvector + GIN（内置）、pgvector + HNSW（内置扩展），不引入外部搜索引擎或向量数据库。

**理由**：
- 数据量小（~2400 段），PostgreSQL 完全能处理
- Supabase Free 方案即支持 pgvector
- 一条 SQL 同时跑两路检索，架构简单
- 将来迁移阿里云 RDS PostgreSQL 时，tsvector 和 pgvector 同样支持，零代码改动

### D4: 不使用图数据库

**理由**：
- 数据是线性文档（信件），不是天然的图结构
- 实体关系用 Topic/CompanyMention 标签 + SQL JOIN 足够
- 额外数据库 = 运维成本翻倍，个人项目不值得

### D5: 不做中文 embedding

**理由**：
- 存储和成本翻倍，没有必要
- 跨语言 embedding（中文 query → 英文 doc）效果不稳定
- Query 翻译是更可控、更可调试的方案

## 数据模型

Section 表新增两个字段：

```
Section
├── contentEn        现有 · 英文原文
├── contentZh        现有 · 中文翻译
├── embedding        新增 · vector(1536) · 基于 contentEn · HNSW 索引
└── searchVector     新增 · tsvector · 基于 contentEn · GIN 索引
```

## 检索流程（对话 RAG）

```
用户中文提问
  │
  ├─① Query 翻译 + 改写（AI API，与 usage check 并行）
  │    "借钱炒股危险吗" → "dangers of leverage margin debt investing"
  │
  ├─② 并行两路检索
  │    ├─ 向量路：query embedding → cosine similarity → top 10
  │    └─ 关键词路：translated query → tsvector @@ plainto_tsquery → top 10
  │
  ├─③ 合并去重 + 加权排序
  │    score = 0.7 × vector_score + 0.3 × keyword_score
  │    取 top 5
  │
  └─④ 喂给巴菲特 persona 生成中文回答
```

## Embedding 方案

- **模型**：使用现有 AI API 的 embedding 端点（火山引擎/DashScope 均提供）
- **维度**：1536（根据模型确定，建表时指定）
- **生成方式**：一次性脚本跑全量（~2400 段，几分钟），新数据增量生成
- **成本**：全量 embedding 约几毛钱，可忽略

## 迁移兼容性

| 环境 | tsvector + GIN | pgvector + HNSW | 迁移成本 |
|------|:-:|:-:|------|
| Supabase（当前） | 内置 | 内置扩展 | — |
| 阿里云 RDS PostgreSQL | 内置 | 支持（PG ≥ 14） | 换 DATABASE_URL |

Prisma ORM + 标准 PostgreSQL SQL，零锁定风险。
