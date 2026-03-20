> 🔒 内部文件，不对外公开。

# Implementation Plan: 与巴菲特对话

> 核心愿景：不只是读信，而是跟巴菲特坐在同一个房间里对话。
> 实现路径：数据结构化 → 对话引擎 → 虚拟人物（渐进式，每步可验证）

## 已完成

- [x] Prisma Schema（Letter, Section + 用户相关模型）(ea0b0c6)
- [x] 数据导入脚本 prisma/seed.ts (55bf370)
- [x] 单封信阅读页面（2024，硬编码）
- [x] SectionCard 双语展示 + 高亮 + AI 分析
- [x] NextAuth 认证（GitHub, Google）
- [x] 数据管道（fetch → parse → translate，2020-2024 PDF 已下载，2024 已解析翻译）
- [x] 主页改为年份列表 (32be0be)
- [x] 动态信件页面 `/letters/[year]` (32be0be)
- [x] P0/P1/P2 修复：移动端响应式、暗黑模式持久化、错误边界、页脚 (95c46a1)

---

## Phase 1: 全量数据结构化（知识库地基）

把 1965-2024 全部 59 封信件结构化入库，并增加主题/公司标注，为对话引擎提供知识基础。

### Task 1.1: 扩展爬虫支持 1965-2019

- 修改 `scripts/parsing/fetch_letters.py`，支持 1965-2019 全部信件 PDF 下载
- 注意：早期信件格式不同（HTML vs PDF），需要适配
- Berkshire 官方页面：https://www.berkshirehathaway.com/letters.html
- **验证：** 59 个年份的 PDF/HTML 全部下载成功

### Task 1.2: 扩展解析管道支持全量信件

- 修改 `scripts/parsing/parse_pdf_sections.py`，适配不同年份的 PDF 格式差异
- 早期信件可能是扫描件 → 需要 OCR（pdfplumber 或 tesseract）
- **验证：** 59 个年份的 sections.json 全部生成

### Task 1.3: 全量 AI 翻译

- 修改 `scripts/parsing/translate_sections.py`，批量翻译全部年份
- 考虑 API 成本和速率限制，支持断点续传
- **验证：** 59 个年份的 sections_zh.json 全部生成

### Task 1.4: 扩展 Seed 脚本

- 修改 `prisma/seed.ts`，支持导入全部年份数据
- **验证：** 数据库包含 59 个年份，总段落数完整

### Task 1.5: Schema 扩展 — 主题标签与公司提及

- 新增 Prisma 模型：
  - `Topic`：主题标签（insurance, technology, valuation...）
  - `CompanyMention`：公司提及（ticker, companyName, sectionId）
  - `SectionTopic`：段落-主题关联
- 运行 `npx prisma migrate dev`
- **测试：** 模型关系正确，查询可用

### Task 1.6: AI 自动标注

- 新建脚本 `scripts/parsing/annotate_sections.py`
- 用 AI 批量提取每个段落的：
  - 提及的公司（公司名 + ticker）
  - 主题标签（从预定义列表 + AI 自由标注）
- 标注结果写入数据库
- **验证：** 抽样检查标注质量

---

## Phase 2: 对话引擎（灵魂）

让用户能输入公司名或主题，与"巴菲特"文字对话。

### Task 2.1: 主题时间线 API

- 新建 `src/app/api/timeline/route.ts`
- 输入：公司名或主题关键词
- 输出：相关段落列表，按年份排序，含原文 + 翻译 + 来源
- 基于 `CompanyMention` 和 `SectionTopic` 查询
- **测试：** 查 "Apple" 返回正确段落；查 "insurance" 返回保险相关段落

### Task 2.2: 主题时间线页面

- 新建 `src/app/explore/page.tsx`
- 搜索框 → 输入公司/主题 → 展示时间线
- 时间线节点：年份、段落摘要、点击展开全文
- **测试：** 搜索、空结果、时间线渲染

### Task 2.3: RAG 对话接口

- 新建 `src/app/api/chat/route.ts`
- 流程：
  1. 用户提问 → 提取关键词
  2. 从数据库检索相关段落（向量搜索或关键词匹配）
  3. 将段落作为上下文，AI 生成"巴菲特式"回答
  4. 回答附带引用来源（年份/段落）
- System prompt 定义巴菲特的说话风格、思考方式
- **测试：** 回答质量、引用来源准确性

### Task 2.4: 对话界面

- 新建 `src/app/chat/page.tsx`
- 多轮对话 UI（类 ChatGPT）
- 每条回答显示引用来源，点击可跳转到原文段落
- **测试：** 多轮对话、引用跳转

---

## Phase 3: 虚拟人（身体）

给对话引擎加上视频和声音，让体验从"读文字"变成"面对面对话"。

### Task 3.1: 虚拟人 API 选型与集成

- 评估 HeyGen / D-ID / 开源方案（SadTalker）
- 评估维度：质量、成本、API 稳定性、延迟
- 选定后，写集成模块 `src/lib/avatar.ts`
- **验证：** 输入文本 → 输出视频 MP4

### Task 3.2: 声音方案

- 评估 ElevenLabs / 其他 TTS 方案
- 选定声音风格（老年美国男性，沉稳、幽默）
- 写集成模块 `src/lib/voice.ts`
- **验证：** 输入文本 → 输出音频 MP3

### Task 3.3: 对话页面升级 — 视频模式

- 扩展 `src/app/chat/page.tsx`
- 用户提问 → AI 生成回答文本 → 生成音频 → 生成视频 → 播放
- 流式体验：文字先出，视频随后
- 降级方案：API 失败时回退到纯文字模式
- **测试：** 完整流程、降级行为

### Task 3.4: 打磨与优化

- 视频生成延迟优化（预生成热门问题？缓存？）
- 移动端适配
- 成本控制（限制每用户每日对话次数？）

---

## Phase 4: 打磨与质量

### Task 4.1: 年度背景卡片

- 新增 `YearContext` Prisma model
- 整理 1965-2024 年度背景数据（标普500、BRK 股价、大事件）
- 新建 `YearContextCard` 组件，集成到信件页面
- **测试：** 有/无 YearContext 两种渲染

### Task 4.2: 段落级公司上下文

- 新增 `CompanyData` Prisma model（公司年度股价数据）
- 新建 `CompanyContext` 组件
- 信中提到公司时，侧边栏展示该公司当年数据
- **测试：** 有/无关联公司两种渲染

### Task 4.3: 翻译质量修复

- 审查早期信件翻译质量
- 短文本/标题类内容特殊处理

### Task 4.4: 覆盖率审查

- 目标 >80% 测试覆盖率
- 补充关键路径测试

---

## 技术决策记录

| # | 决策 | 理由 |
|---|---|---|
| D1 | 数据先行，虚拟人后做 | 没有灵魂的身体是空壳 — 先结构化知识，再做对话 |
| D2 | 渐进式三步走 | 每步都有可展示成果，随时可停，避免中途失去动力 |
| D3 | RAG 而非 fine-tune | 可追溯来源，成本低，迭代快；fine-tune 是优化项 |
| D4 | 虚拟人用 API 而非自建 | 业余项目优先用成熟方案，不造轮子 |
| D5 | 主题/公司标注用 AI 自动提取 | 59 年信件手动标注不现实，AI 提取 + 抽样审查 |
| D6 | 目标市场：中国为主 | 中文解读 + 原文对照是核心护城河，英文市场竞争激烈且优势不明显 |
| D7 | 部署：Vercel 新加坡 region | 中国可达，无需备案，serverless 运维成本低；规模化后评估迁移阿里云 |
| D8 | 数据库：Supabase PostgreSQL | Vercel serverless 不支持 SQLite；Prisma schema 迁移成本极低 |
| D9 | 认证：手机号短信（阿里云短信） | GitHub/Google OAuth 在中国被封；手机号是国内最低摩擦的注册方式 |
| D10 | 支付 MVP：LemonSqueezy | 无需营业执照，快速验证付费意愿；正式运营后迁移 Ping++（微信/支付宝）|

## 基础设施迁移清单（开发 → 生产）

| 层 | 当前 | 目标 | 优先级 |
|---|---|---|---|
| 数据库 | SQLite 本地文件 | Supabase PostgreSQL 新加坡 | **P0** 部署前必须 |
| 认证 | GitHub / Google OAuth | 手机号 + 阿里云短信验证码 | **P0** 部署前必须 |
| 限流 | 内存 Map（重启清零） | Upstash Redis 新加坡 | P1 |
| 支付 | 无 | LemonSqueezy | P1 |
| 日志监控 | 无 | Vercel Analytics + Sentry | P2 |

## NOT in scope（明确延后）

| 事项 | 理由 |
|---|---|
| 视频/股东大会转录 | 数据获取和处理复杂度高，Phase 3 完成后再考虑 |
| 自训练虚拟人模型 | API 方案足够，自训练 ROI 不高 |
| 英文版 / 多语言 | 先在中国市场跑通商业模式，再考虑出海 |
| 社交分享卡片 | 非核心功能 |
| 向量数据库 | 先用关键词匹配，效果不够再上向量搜索 |
| 微信登录 | 需要公众号资质，个人开发者暂时做不了 |
| Ping++ 支付 | 需要营业执照，MVP 阶段用 LemonSqueezy 代替 |
