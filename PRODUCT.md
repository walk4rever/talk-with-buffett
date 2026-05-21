> 🔒 内部文件，不对外公开。

# 巴菲特部落 · Buffett Tribe — 产品设计文档

> 最后更新：2026-05-21（v0.35.2）

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

当前公司页已经接通真实数据源与批处理入库流程，不再是纯 Mock 页面。

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
| 前端 | Next.js 16 App Router · TypeScript · React |
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

## 当前实现状态（v0.35.2）

| 功能 | 状态 |
|------|------|
| /master 大师页面 | ✅ 已上线 |
| /idea 对话界面 | ✅ 已上线 |
| /company/[cik] 公司页 | ✅ 已上线 |
| Company Canvas（6 Tab UI） | ✅ 已实现 |
| Company Analysis 批量入库 | ✅ 已实现 |
| Canvas 实时生成（RAG → AI） | 🟡 部分实现，仍在迭代 |
| Company Brain 写回 | 🟡 部分实现 |
| Fact Fetch Pipeline | 🟡 已有批处理脚本，持续补齐 |
| 持仓数据更新 | 🟡 以季度批处理为主 |

---

## 数据与脚本

脚本现在比较多，按职责分组如下。日常维护优先走这些命令，而不是直接改库。

### 导入

- `npm run import:13f` / `npm run import:13f:range`：导入 13F 持仓
- `npm run import:10k`：按 ticker / 年份导入 10-K、20-F 财务数据
- `npm run import:10k:from13f`：从 13F 持仓反推需要补齐的公司财务
- `npm run pipeline:13f` / `npm run pipeline:10k`：完整流水线封装

### 回填与修复

- `npm run backfill:security:company-links`：把 security 重新挂到正确 company
- `npm run backfill:security:table`：修正 security 表历史数据
- `npm run backfill:company:profiles`：补公司 profile 元数据
- `npm run backfill:names`：补中文名 / 英文短名
- `npm run sync:company-name-map`：让 `company_name_map` 跟实体数据对齐
- `npm run cleanup:duplicate-companies`：清理重复 company 实体
- `npm run generate:master-profile`：补大师主页 profile
- `npm run generate:portfolio-insight`：生成持仓洞察

### 巡检

- `npm run check:security:integrity`：检查 security 关联完整性
- `npm run check:financial:integrity`：检查财务数据完整性
- `npm run check:latest-holdings:coverage`：检查三位投资者最新季持仓公司的 5 年财务与 analysis 覆盖
- `npm run check:latest-holdings:coverage:json`：机器可读 JSON 输出
- `npm run check:db`：数据库健康检查
- `scripts/check-all-company-financials.ts`：全量公司财务巡检

### 自动补齐

- `npm run fix:latest-holdings:coverage`：按巡检结果自动补齐缺口
- `scripts/run-company-analysis.ts`：批量生成并入库 company analysis
- `scripts/import-10k-xbrl.ts`：现在支持 `companyfacts + filing-level inline XBRL fallback`

### 实验与基准

- `scripts/eval-*.ts`：检索与 MVP 评测
- `scripts/neo4j-*.ts`：图谱抽取、导入、演练
- `scripts/bench-live-asr-*.ts` / `scripts/test-volc-asr.mjs`：语音链路实验

### 维护原则

- 先跑巡检，再跑修复，最后才考虑手工改库
- 只要能写成脚本，就不要在数据库里临时补
- 新脚本优先挂到 `package.json`，避免隐蔽入口继续增加

---

## 运维速查表

### 最常用

- `npm run import:13f`
- `npm run import:10k -- --ticker TME --from 2025 --to 2025`
- `npm run check:latest-holdings:coverage`
- `npm run fix:latest-holdings:coverage`
- `node --env-file=.env.local ./node_modules/.bin/tsx scripts/run-company-analysis.ts --all`

### 数据修复

- `npm run backfill:security:company-links`
- `npm run sync:company-name-map`
- `npm run cleanup:duplicate-companies`
- `npm run backfill:company:profiles`
- `npm run backfill:names`

### 巡检

- `npm run check:security:integrity`
- `npm run check:financial:integrity`
- `npm run check:db`
- `scripts/check-all-company-financials.ts`

### 规则

- 先查缺口，再补数据，再做手工修正
- 12F / 10-K / analysis 的批处理都优先脚本化
- 数据源优先级：`companyfacts` -> filing-level inline XBRL -> 手工修复
