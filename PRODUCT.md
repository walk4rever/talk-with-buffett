> 🔒 内部文件，不对外公开。

# 巴菲特部落 · Buffett Tribe — 产品设计文档

> 最后更新：2026-05-14（v0.36.0）

---

## 产品定位

**买股票就是买公司。巴菲特部落用价值投资大师的框架帮你理解一家公司。**

用户来这里不是为了读懂巴菲特，而是为了用巴菲特的方式看一家公司：
护城河在哪里？管理层可信吗？现在的价格有安全边际吗？

大师原文、13F 持仓、财务数据——这些是分析的燃料，不是产品的终点。

---

## 三个核心页面

```
/master   大师         巴菲特、李录、段永平的信件、演讲、持仓
/company  公司         任意一家公司的研究画布（Canvas）
/idea     对话研究室    与大师思想对话，自动触发公司分析
```

### /master — 大师

价值投资大师的原始资料库：股东信、合伙人信、演讲、访谈。每位大师有独立页面，展示材料列表与 13F 持仓快照。材料全文可阅读，可跳转到 /idea 继续追问。

### /company — 公司

任意一家公司的研究画布。Canvas 用五维框架结构化呈现：

| Tab | 内容 |
|-----|------|
| 概览 | 公司名、股票代码、市场、商业模式 |
| 财务 | 核心财务指标（营收、毛利率、ROIC 等）+ 趋势 |
| 好生意 | 护城河 · 可理解性 · 持久性 — 结论 + 支持/反方证据 + 置信度 |
| 好管理 | 资本分配 · 诚信 · 股东利益一致 |
| 好价格 | 内在价值 · 安全边际 · 赔率 |
| 研判 | 当前投资决策状态 + 参考来源 + 待验证问题 |

Canvas 的数据来自两个渠道：
- 结构化事实层（财务数据，来自 EDGAR / 市场数据 API）
- 对话沉淀层（Company Brain，随用户对话写回积累）

### /idea — 对话研究室

全站唯一的对话界面。左侧与大师思想对话，右侧实时显示对应公司的研究画布。

**默认状态**：右侧展示 Apple 画布（冷启动占位），左侧空对话等待提问。

**对话触发 Canvas 更新**：用户在对话中提到公司名（泡泡玛特、比亚迪、Apple…），右侧 Canvas 自动切换到该公司。

**原文跳读**：对话引用原文时，点击来源芯片可展开原文阅读模式。

---

## 公司覆盖模型：冷→热演进

```
第 1 个用户引入新公司
  ↓
系统新建 company 记录 → LLM 基于实时搜索回答 → 对话结束写回首批 Claim
  ↓（同时）
Cron Job 触发 Fact Fetch Pipeline
  → 财务数据 / 基本面写入（次日生效）

第 2 个用户
  ↓
已有初始 Fact 层 + 第 1 轮沉淀 Claim → Canvas 有初始内容
  ↓
对话结束再次写回 → Brain 进一步丰富

第 N 个用户
  ↓
多轮沉淀：Claim/Evidence/Counter-Evidence
置信度随讨论次数收敛，Canvas 开箱即用
```

覆盖范围不限于大师持仓——任何用户引入的公司都成为 Brain 节点。

---

## 设计语言

Apple HIG 精简风格：
- 白色卡面 `#ffffff`，浅灰底 `#f5f5f7`，header/tabbar 用 `#fbfbfd`
- `0.5px` border，无重阴影
- 6 等分 Tab 网格，文字居中，蓝色底线标记激活态
- 全站单一字体栈：`system-ui, -apple-system, Helvetica Neue`

---

## 技术栈

| 层 | 选型 |
|----|------|
| 前端 | Next.js 15 App Router · TypeScript · React |
| 样式 | 手写 CSS（globals.css），无 Tailwind |
| 数据库 | PostgreSQL via Prisma (Supabase) |
| AI | Claude API（对话 + 分析生成） |
| 持仓数据 | SEC EDGAR 13F-HR |
| 财务数据 | EDGAR XBRL + 外部市场数据 API |
| 认证 | NextAuth.js |
| 部署 | Vercel |

---

## 路由结构

```
/                   首页（信号流 + 大师入口 + Hero Search）
/master/[id]        大师主页（材料库 + 持仓）
/master/[id]/library  文章/信件列表
/master/[id]/holdings 持仓快照
/company/[cik]      公司研究画布
/idea               对话研究室（左：对话，右：Canvas）
/login              登录
```

---

## 当前实现状态（v0.36.0）

| 功能 | 状态 |
|------|------|
| /master 大师页面 | ✅ 已上线 |
| /idea 对话界面 | ✅ 已上线 |
| Company Canvas（6 Tab UI） | ✅ 已实现（Mock 数据） |
| Canvas 实时生成（RAG → AI） | 🔲 待开发 |
| Company Brain 写回 | 🔲 待开发 |
| /company/[cik] 公司页 | 🔲 待开发 |
| Fact Fetch Pipeline | 🔲 待开发 |
| 持仓数据实时更新 | 🔲 待开发 |
