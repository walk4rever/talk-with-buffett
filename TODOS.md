> 🔒 内部文件，不对外公开。

# TODOS — 当前工作队列

> 功能/决策/架构详见 PRODUCT.md

## ✅ 已完成

- [x] Prisma Schema（Letter, Chunk + 用户模型）
- [x] 数据导入 — 60 封股东信 + ~30 封合伙人信，1413 chunks
- [x] 主页年份列表 + 动态信件页 `/letters/[type]/[year]`
- [x] NextAuth 认证（Credentials）
- [x] 移动端响应式、暗黑模式持久化、错误边界
- [x] 对话 API `/api/chat` — 混合检索 + RAG + 引用来源 + 每日限额
- [x] 巴菲特人格 Prompt
- [x] SSE 流式输出
- [x] 混合检索 — tsvector + pgvector (1024-dim HNSW)
- [x] 后端主导引用机制（杜绝幻觉）
- [x] 阅读页 — contentMd 直接渲染，中英交替 + 单语过滤
- [x] 代码清理 — 删除 Section 及所有依赖代码（-4800 行）

---

## 🚀 MVP（当前阶段）

目标：完整的对话+阅读体验 + 数据追踪 + 支付链路，可以交给种子用户。

### 收尾任务

- [ ] 线上 migration 部署 — 跑 `drop_section_tables`，验证 Vercel build 通过
- [ ] 对话质量验收 — 准备 10 个测试问题，验证检索召回率 + 引用出现
- [ ] 移动端体验打磨 — 阅读页、对话抽屉在手机上的交互细节

### Phase A：数据模型重构（Letter → Source）

- [ ] Prisma schema 重命名 Letter → Source + 新增字段（videoUrl, videoSource, thumbnailUrl）
- [ ] Chunk.letterId → Chunk.sourceId
- [ ] type 值保持不变（shareholder, partnership），新增 article, annual_meeting, interview
- [ ] 代码全量替换（search.ts, prompts/buffett.ts, api/chat/route.ts, 页面组件）
- [ ] import 脚本适配
- [ ] 验证：现有功能不受影响

### Phase C：统一工作区

- [ ] Chat + Canvas 分屏组件
- [ ] 引用点击 → Canvas 打开对应内容并定位段落
- [ ] 独立页面点击"对话" → 进入工作区
- [ ] 工作区 URL（支持刷新/分享）
- [ ] 移动端全屏切换（Chat ↔ Canvas）
- [ ] 关闭按钮退出分屏
- [ ] 记住各内容滚动位置
- [ ] 验证：两种入口收敛到同一终态

### Phase B：股东大会数据导入（1994-2024）

- [ ] 导入 31 篇大会转录（1994-2024，复用 import 脚本，`--type annual_meeting`）
- [ ] 首页大会分区
- [ ] 大会阅读页（复用 LetterReadingArea）
- [ ] 验证：检索覆盖大会内容

### Phase F：用户数据 + 支付

- [ ] ChatMessage 表 + 对话记录写入
- [ ] 对话评分（👍👎）— 写入 ChatMessage.rating
- [ ] PostHog 接入（posthog-js + Next.js integration）
- [ ] 关键事件埋点（page_view, chat_start, chat_message, source_click 等）
- [ ] LemonSqueezy 订阅集成
- [ ] 订阅状态校验（免费 vs 会员的次数限制）
- [ ] 验证：完整的免费→付费转化链路

---

## 📦 Post-MVP

### Phase D：视频播放支持

- [ ] 视频播放页（embed 播放器 + 转录文本）
- [ ] 首页视频分区
- [ ] 工作区 Canvas 支持视频内容

### Phase E：公开文章 + 采访

- [ ] 收集文章链接 + markdown
- [ ] 文章导入 + 阅读页
- [ ] 采访视频 + 转录导入
- [ ] 首页对应分区

### 对话体验增强

- [ ] 多轮对话上下文 — 加入对话历史摘要，让追问更自然
- [ ] 首页对话入口 — 主页直接提问（HeroChatInput 已有框架）
- [ ] 对话分享 — 生成分享链接或图片，适合社交传播

### 内容探索

- [ ] 主题时间线 — "巴菲特历年怎么看保险？" → 按年份展示相关段落
- [ ] 探索页 `/explore` — 搜索框 + 年份分组结果
- [ ] 热门话题标签 — AI 预标注每个 chunk 的主题

### 虚拟人（差异化）

- [ ] API 选型 — HeyGen / D-ID / 开源方案评估
- [ ] 声音方案 — TTS 选型，合规性确认
- [ ] 视频对话模式 — 对话页面升级，延迟优化 + 成本控制

### 打磨

- [ ] 年度背景卡片 — 每封信配当年经济/市场背景摘要
- [ ] SEO 优化 — meta tags、结构化数据、sitemap
- [ ] 测试覆盖率 >80%

---

## 🔍 待调研

- [ ] 虚拟人 API 效果评估
- [ ] 声音克隆合规性
- [ ] PostHog Cloud 中国可达性测试
