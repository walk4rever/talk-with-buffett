# 巴菲特部落 · Value Archive

> 伟大价值投资人的思想，结构化为可程序化访问的知识图谱。

---

## 产品

**[buffett.air7.fun](https://buffett.air7.fun)** — 与巴菲特对话，每条回答基于真实信件，引用可溯源至具体年份与段落。

---

## 面向开发者

Value Archive 通过 MCP Server 和 REST API 对外暴露投资知识检索能力，任何 AI Agent 可直接调用。

### MCP Server

```bash
# Claude Desktop / Claude Code 配置
{
  "mcpServers": {
    "value-archive": {
      "url": "https://buffett.air7.fun/mcp"
    }
  }
}
```

### 可用工具

| 工具 | 说明 |
|------|------|
| `semantic_search` | 语义检索：概念、观点、投资哲学 |
| `graph_facts` | 结构化事实：公司关系、概念出处、持仓时间线 |
| `full_text_search` | 精确检索：人名、公司名、专有术语 |
| `find_concept_evolution` | 一个概念随时间的演变轨迹 |
| `list_company_mentions` | 某公司在所有文献中的全部提及 |
| `compare_investors` | 不同投资人对同一概念的观点对比 _(roadmap)_ |

### REST API

```bash
# 语义检索
POST /api/tools/semantic-search
{ "query": "how to evaluate management integrity", "investor": "buffett" }

# 结构化事实查询
GET /api/tools/graph-facts?entities=moat&investor=buffett&year_from=1980
```

---

## 数据覆盖

**Buffett 模块（已有）**

- 伯克希尔股东信 1965–2025（61 篇）
- 合伙人信件 1957–1970（33 篇）
- 股东大会记录 1985–2024（34 届）

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

PostgreSQL (pgvector + tsvector) · Neo4j · Next.js · TypeScript

---

*本项目与任何投资人本人及其所属机构无任何关联。所有内容基于公开资料，仅供学习研究使用。*
