# Implementation Plan: 穿越式阅读 MVP

## 已完成
- [x] Prisma Schema（Letter, Section + 用户相关模型）(ea0b0c6)
- [x] 数据导入脚本 prisma/seed.ts (55bf370)
- [x] 单封信阅读页面（2024，硬编码）
- [x] SectionCard 双语展示 + 高亮 + AI 分析
- [x] NextAuth 认证（GitHub, Google）
- [x] 数据管道（fetch → parse → translate，2020-2024 PDF 已下载，2024 已解析翻译）

## Phase 1: 年份导航
把硬编码的单封信页面拆成多年份可导航的结构。

- [ ] Task 1.1: 主页改为年份列表
  - 改造 `src/app/page.tsx`：查询所有 Letter，按年份降序展示
  - 每个年份卡片显示：年份、标题、段落数
  - 点击跳转到 `/letters/[year]`
  - **测试：** 列表渲染、空数据空状态

- [ ] Task 1.2: 动态信件页面 `/letters/[year]`
  - 新建 `src/app/letters/[year]/page.tsx`
  - 将现有 `page.tsx` 的信件展示逻辑迁移过来
  - 参数校验：year 不存在时返回 404
  - **测试：** 正常渲染、year 不存在返回 404

- [ ] Task 1.3: 补全 2020-2023 年数据
  - 对已下载的 4 个年份 PDF 执行 parse + translate 管道
  - 更新 seed.ts 导入所有年份
  - 验证：5 个年份数据完整可读

## Phase 2: 年度背景卡片（核心差异化 — 第一刀）
每封信顶部展示那一年的市场环境，让用户"回到那个时代"。

```
  ┌─────────────────────────────────────────────┐
  │  2024 Shareholder Letter                    │
  ├─────────────────────────────────────────────┤
  │  ┌─────────────────────────────────────┐    │
  │  │ 📊 时代背景                  2024    │    │
  │  │ S&P 500: +24.2%  BRK-A: $544→$690  │    │
  │  │ • Fed 降息周期开启               │    │
  │  │ • AI 浪潮推动科技股              │    │
  │  └─────────────────────────────────────┘    │
  │                                             │
  │  [段落1 英文]                               │
  │  [段落1 中文]                               │
  │  ...                                        │
  └─────────────────────────────────────────────┘
```

- [ ] Task 2.1: YearContext Prisma model + migration
  - 新增 `YearContext` model：year(unique), spReturn, brkPriceStart, brkPriceEnd, events(JSON)
  - 关联 Letter：`Letter` 添加可选 `yearContext` 关系
  - 运行 `npx prisma migrate dev`

- [ ] Task 2.2: 准备年度背景数据 + seed
  - 整理 2020-2024 五年数据：标普500收益率、BRK-A 股价（年初/年末）、2-3 条大事件
  - 数据来源：Yahoo Finance（股价）、手动整理（事件）
  - 扩展 seed.ts：导入 YearContext 数据

- [ ] Task 2.3: YearContextCard 组件
  - 新建 `src/components/YearContextCard.tsx`
  - 展示：标普收益率（绿涨红跌）、BRK-A 股价变化、年度大事件列表
  - 纯展示 Server Component，数据通过 props 传入
  - **测试：** props 渲染、数据缺失时不崩溃

- [ ] Task 2.4: 信件页集成
  - `/letters/[year]/page.tsx` 查询 YearContext 数据
  - 有数据 → 渲染 YearContextCard；无数据 → 不渲染（不报错）
  - **测试：** 有/无 YearContext 两种情况

## Phase 3: 段落级公司上下文（第二刀）
信中提到具体公司时，展示该公司当年的关键数据。

```
  ┌──────────────────────────────────┬──────────────────┐
  │  "We purchased Occidental        │  📈 OXY          │
  │   Petroleum shares..."           │  $57→$63 (+10.5%)│
  │                                  │  石油天然气公司    │
  │  "我们买入了西方石油的股份..."      │                  │
  └──────────────────────────────────┴──────────────────┘
  桌面端：右侧面板          移动端：折叠在段落下方
```

- [ ] Task 3.1: CompanyData + EntityMention Prisma models + migration
  - `CompanyData`: ticker(unique per year), name, year, priceStart, priceEnd, description
  - `EntityMention`: sectionId(FK), companyTicker, 关联 Section
  - 运行 migration

- [ ] Task 3.2: 实体标注 + 公司数据 seed
  - AI 一次性提取 2024 年各 section 提到的公司（公司名 + ticker）
  - 整理对应公司的年度股价数据（Yahoo Finance）
  - 扩展 seed.ts：用 `year + order` 查找已有 section，再创建 EntityMention 关联
  - 先覆盖 2024 年（预计 10-15 家公司）
  - **测试：** seed 后验证关联数据完整性

- [ ] Task 3.3: CompanyContext 组件
  - 新建 `src/components/CompanyContext.tsx`
  - 展示：公司名、ticker、股价变化（绿涨红跌）、一句话描述
  - 使用 `dynamic(() => import(...))` 懒加载，避免 53 个段落同时 hydrate
  - **测试：** props 渲染、懒加载行为

- [ ] Task 3.4: SectionCard 集成
  - 修改 `src/components/SectionCard.tsx`
  - 接收 entity mentions 数据，有关联公司时渲染 CompanyContext
  - 信件页面查询 EntityMention + CompanyData，按 section 分组后传入
  - 移动端：折叠在段落下方；桌面端：右侧面板
  - **测试：** 有/无关联公司两种渲染情况

## Phase 4: 打磨与质量

- [ ] Task 4.1: 翻译质量修复
  - 审查 2024 年 sections_zh.json，修复明显错误（如第1条标题被错误翻译）
  - 短文本/标题类内容：跳过翻译或特殊处理

- [ ] Task 4.2: 覆盖率审查
  - 运行 `npm run test:coverage`
  - 识别未覆盖路径，补充测试
  - 目标 >80%

- [ ] Task 4.3: 响应式与性能
  - Lighthouse 跑信件页，LCP > 3s 时进一步优化
  - 移动端 YearContextCard + CompanyContext 布局验证
  - 图片/数据懒加载检查

## 技术决策记录

| # | 决策 | 理由 |
|---|---|---|
| D1 | 背景数据入 Prisma（非 JSON 文件） | 统一数据源，为后续持仓/跨年份功能打基础 |
| D2 | EntityMention seed 用 `year + order` 查找 Section | section cuid 每次 reseed 会变，`year + order` 是唯一稳定标识 |
| D3 | 测试内嵌各 Phase，非集中在最后 | 每个阶段有安全网，避免后期大面积回头改 |
| D4 | CompanyContext 使用 dynamic import 懒加载 | 53 个段落 + CompanyContext 全量 hydrate 有性能风险 |

## NOT in scope（明确延后）

| 事项 | 理由 |
|---|---|
| SEC 13F 持仓变动数据 | 数据获取和解析复杂度高，MVP 后再做 |
| 跨年份主题串联 | 依赖大量信件的实体标注积累，Phase 3 完成后再规划 |
| 社交分享卡片 | 非核心差异化功能 |
| 1965-2019 历史信件 | 先用 2020-2024 验证产品方向 |
| 个人笔记功能 | Schema 已有 Note model，UI 延后 |
| AI 分析接入真实 API | 当前存根够用，等产品验证后再投入 |
