# 巴菲特部落 · Buffett Tribe

> 价值投资大师的思想图谱 — 阅读、对话、研究，一站式投资人知识库。

---

## 产品定位

**Buffett Tribe** 是一个面向价值投资者的知识平台，把伟大投资人的公开著作、信件、演讲与访谈，结构化整理为可深度阅读和 AI 对话的知识图谱。

以巴菲特为起点，向李录、段永平、芒格等价值投资先驱扩展。核心价值：**精心整理的原始资料 + AI 辅助研读**，不是泛化问答，而是有来源可溯、有原文可查的深度研究工具。

---

## 主要功能

### 资料库 · Library

按人物组织的四分类资料库，每类有独立的阅读体验：

| 分类 | 内容 | 巴菲特现状 |
|------|------|-----------|
| **信件** | 年度信件（整篇通读，字体/行距可调） | 致股东信 1965–2025 · 合伙人信 1958–1970 |
| **文章** | 公开文章、采访稿、雪球发言 | 建设中 |
| **书籍** | 专著、演讲集 | 建设中 |
| **视频** | 股东大会、采访视频 + 文字整理 | 建设中 |

访问路径：`/master/buffett/library`

### 对话 · Chat

基于原始文献的 AI 对话，每条回答引用可溯源至具体年份与段落。

- 混合检索（关键词 + 语义向量）
- 引用点击直接跳转对应原文段落
- 支持多轮追问

访问路径：`/chat`

### 工作区 · Text Room

Chat + 原文阅读的分屏工作区，阅读时触发对话，对话时引用原文，双向联动。

访问路径：`/text/room`

### 投资人持仓 · Holdings

Berkshire 13F 持仓分析，季度环比变化、新进/退出标的追踪。

访问路径：`/master/buffett/holdings`

### 标的纵向叙事 · Company

单只标的的三层叠加视图：Buffett 信件提及 + 公司基本面（EDGAR XBRL）+ 价值投资人持仓（13F）。

访问路径：`/company/[ticker]`

---

## 技术接口

### MCP Server

任何支持 MCP 的 AI 客户端（Claude Desktop、Cursor、Claude Code 等）一行配置接入：

```json
{
  "mcpServers": {
    "buffett-tribe": {
      "type": "http",
      "url": "https://buffett.air7.fun/api/mcp"
    }
  }
}
```

#### MCP 工具

| 工具 | 说明 |
|------|------|
| `search` | 混合检索（关键词 + 语义），覆盖 1958–2025 全部文献，支持年份过滤 |
| `get_document` | 按 sourceId 或年份+类型获取完整文档，分页返回 |
| `graph` | 查询知识图谱中的实体关系（公司、概念、人名） |

### REST API

```bash
# 混合检索
GET /api/tools/search?q=QUERY&yearFrom=YYYY&yearTo=YYYY&limit=N

# 读取完整文档（分页，10 chunks/页）
GET /api/tools/document?year=YYYY&type=shareholder|partnership&page=N
GET /api/tools/document?sourceId=ID&page=N

# 实体关系图谱
GET /api/tools/graph?entity=ENTITY&yearFrom=YYYY&yearTo=YYYY&limit=N

# 原始 Source 列表
GET /api/source?type=shareholder&year=2024
```

无需认证，Base URL：`https://buffett.air7.fun`

---

## 数据覆盖

### 巴菲特（已有）

| 内容 | 数量 | 状态 |
|------|------|------|
| 伯克希尔股东信 | 61 篇（1965–2025） | ✅ |
| 合伙人信件 | 33 篇（1958–1970） | ✅ |
| 股东大会记录 | 34 篇（1985–2024） | 🔲 导入中 |
| 13F 持仓数据 | 季度更新 | ✅ |

### 路线图

| 投资人 | 主要内容 | 状态 |
|--------|---------|------|
| 巴菲特 | 信件 + 大会 + 持仓 | ✅ 已有 |
| 李录 | 演讲、书籍《文明、现代化、价值投资与中国》 | 🔲 建设中 |
| 段永平 | 雪球公开发言、访谈 | 🔲 建设中 |
| 芒格 | Poor Charlie's Almanack、演讲 | 🔲 规划中 |

---

## 本地运行

```bash
npm install
cp .env.example .env.local
# 配置 DATABASE_URL / VOLCENGINE_API_KEY 等
npm run dev
```

---

## 技术栈

| 层 | 技术 | 用途 |
|----|------|------|
| 应用框架 | Next.js 16 + TypeScript | Web + API Routes |
| 数据库 | PostgreSQL (Supabase) | 原始文本、用户数据、向量检索 |
| 语义检索 | pgvector (doubao text-embedding-v3 1024d) | 向量相似度搜索 |
| 全文检索 | tsvector + GIN | 关键词精确匹配 |
| AI 对话 | 火山引擎 / OpenAI 兼容 | 问答生成 |
| 协议 | MCP (Streamable HTTP) | AI Agent 接入 |
| 部署 | Vercel（新加坡） | 中国可达 |
| 数据库托管 | Supabase（新加坡） | PostgreSQL + pgvector |

---

*本项目与任何投资人本人及其所属机构无任何关联。所有内容基于公开资料，仅供学习研究使用。不构成任何投资建议。*
