# 巴菲特部落 · Buffett Tribe

> 伟大价值投资人的思想，结构化为可程序化访问的知识图谱。

---

## 访问路径

```
Buffett Tribe 知识图谱
        │
   ┌────┴────────────────────────┐
   │                             │
 Web（我们做）              开放给外部
 面向普通用户               面向开发者 / AI Agent
   │                             │
buffett.air7.fun          MCP · REST API · CLI
与巴菲特对话               接入任意 agent 工作流
```

**Web** 是我们自己做的第一个消费者，也是产品的门面。  
**MCP / API / CLI** 是对外开放的服务接口，商业化的主要路径。

---

## Web

**[buffett.air7.fun](https://buffett.air7.fun)** — 与巴菲特对话，每条回答基于真实信件，引用可溯源至具体年份与段落。

---

## MCP Server

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

### 可用工具

| 工具 | 说明 |
|------|------|
| `search` | 混合检索（关键词 + 语义），覆盖 1958–2025 全部文献，支持年份过滤 |
| `get_document` | 按 sourceId 或年份+类型获取完整文档，分页返回 |
| `graph` | 查询知识图谱中的实体关系（公司、概念、人名），含时间维度 |

---

## REST API

```bash
# 搜索（关键词 + 语义混合检索）
GET /api/tools/search?q=QUERY&yearFrom=YYYY&yearTo=YYYY&limit=N

# 读取完整文档（分页，10 chunks/页）
GET /api/tools/document?year=YYYY&type=shareholder|partnership&page=N
GET /api/tools/document?sourceId=ID&page=N

# 实体关系图谱
GET /api/tools/graph?entity=ENTITY&yearFrom=YYYY&yearTo=YYYY&limit=N
```

所有接口无需认证，Base URL：`https://buffett.air7.fun`

---

## 数据覆盖

**Buffett 模块（已有）**

- 伯克希尔股东信 1965–2025（61 篇）
- 合伙人信件 1958–1970（33 篇）
- 股东大会记录（待导入）

**投资人路线图**

Buffett ✅ → Munger 🔲 → Graham 🔲 → Lynch 🔲 → Klarman 🔲

---

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

需要配置：`DATABASE_URL` · `AI_API_KEY` · `NEO4J_URI`

---

## 技术栈

| 层 | 技术 | 用途 |
|----|------|------|
| 内容存储 | PostgreSQL (Supabase) | 原始文本、用户数据 |
| 语义检索 | pgvector | 向量相似度搜索 |
| 全文检索 | tsvector | 关键词精确匹配 |
| 知识图谱 | Neo4j | 实体关系、图遍历 |
| 应用框架 | Next.js + TypeScript | Web + API |

---

*本项目与任何投资人本人及其所属机构无任何关联。所有内容基于公开资料，仅供学习研究使用。*
