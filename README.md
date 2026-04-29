# 巴菲特部落 · Value Archive

> 伟大投资人的思想，以知识图谱的方式永久留存。

---

## 是什么

**Value Archive** 是一个面向 AI Agent 生态的**投资知识 API + MCP 服务**。

它把伟大价值投资人的公开著作、演讲与信件，结构化为可程序化访问的知识图谱——不是把文字塞进向量库，而是提取实体、关系与概念演变，让 AI Agent 能真正理解和推理投资思想。

以巴菲特为起点，逐步扩展至 Munger、Graham、Lynch、Klarman 等价值投资先驱。

---

## 设计思路

### 为什么是知识图谱，而不只是 RAG

普通 RAG 能回答"巴菲特说了什么"，但无法回答：
- 巴菲特对科技股的态度，这 30 年发生了哪些变化？
- 护城河概念和定价权之间是什么关系？
- 列出他明确表示买入过又卖出过的所有公司

知识图谱让这类**结构化事实查询**和**跨时间推理**成为可能。

### 护城河不是基础设施，是内容质量

不做通用 RAG 平台——那个赛道有 Dify、LlamaIndex、微软 GraphRAG。

Value Archive 的壁垒是：精心策划的实体关系、多投资人跨年代的 schema 设计，以及专为 AI Agent 设计的工具接口。内容越积累，越难复制。

---

## 产品结构

```
Layer 1 · 知识服务（面向开发者 / AI Agent）
  ├── MCP Server     — 接入 Claude Desktop / Claude Code / 任意 MCP 客户端
  ├── REST API       — OpenAI-compatible tool schema，任何 agent 可调用
  └── Claude Code Skill — 一行接入 Claude Code 生态

Layer 2 · Chat Demo（面向普通用户）
  └── buffett.air7.fun — 与巴菲特对话，是知识服务的消费者
```

---

## API / MCP 工具

| 工具 | 说明 |
|------|------|
| `semantic_search` | 语义检索：找到概念相关的段落（pgvector） |
| `graph_facts` | 结构化事实：公司关系、概念出处、持仓时间线（Neo4j） |
| `full_text_search` | 精确检索：人名、公司名、专有术语（tsvector） |
| `find_concept_evolution` | 一个概念在某投资人著作中随时间的演变轨迹 |
| `list_company_mentions` | 某公司在所有文献中的全部提及，按年份排列 |
| `compare_investors` | 不同投资人对同一概念的观点对比 _(roadmap)_ |

---

## 数据（Buffett 模块）

| 内容 | 数量 | 状态 |
|------|------|------|
| 伯克希尔股东信（1965–2025） | 61 篇 | ✅ |
| 合伙人信件（1957–1970） | 33 篇 | ✅ |
| 股东大会记录（1985–2024） | 34 届，2556 chunks | ✅ |
| 公开文章 / 采访 | 待收集 | 🔲 |

所有内容双语（英文原文 + 中文译文），embedding 基于英文，支持中英文问题检索。

---

## 投资人路线图

```
Buffett   ████████████  ✅ 已有
Munger    ░░░░░░░░░░░░  🔲 规划中
Graham    ░░░░░░░░░░░░  🔲 规划中
Lynch     ░░░░░░░░░░░░  🔲 规划中
Klarman   ░░░░░░░░░░░░  🔲 规划中
```

---

## 技术栈

| 层 | 技术 |
|----|------|
| 语义检索 | PostgreSQL + pgvector（doubao text-embedding-v3，1024-dim） |
| 全文检索 | PostgreSQL + tsvector + GIN 索引 |
| 知识图谱 | Neo4j（实体、关系、概念演变） |
| API 服务 | Next.js App Router + TypeScript |
| 知识服务接口 | MCP server + REST API |
| Chat Demo | Next.js + SSE 流式输出 |

---

## 快速开始

```bash
npm install
cp .env.example .env.local
# 填写 DATABASE_URL / AI_API_KEY / NEO4J_URI
npm run dev
```

---

*Value Archive 与伯克希尔·哈撒韦公司及任何投资人本人无任何关联。所有内容基于公开资料，仅供学习研究使用。*
