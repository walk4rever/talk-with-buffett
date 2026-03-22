> 🔒 内部文件，不对外公开。

# TODOS — 当前工作队列

> 对应 PLAN.md — 与巴菲特对话（渐进式三步走）
> 检索架构详见 DESIGN.md

## ✅ 已完成

- [x] **主页改为年份列表** (Task 1.1 旧) (32be0be)
- [x] **动态信件页面** `/letters/[year]` (32be0be)
- [x] **数据验证** — seed 导入 2024 年 54 段，8 个测试全部通过
- [x] **P0 修复** — 移动端响应式、AI 分析加载状态 (95c46a1)
- [x] **P1 修复** — 暗黑模式持久化、高亮持久性 (95c46a1)
- [x] **P2 修复** — 页脚信息、错误边界 (95c46a1)
- [x] **UI 重设计** — 极简主页、双栏联动阅读、ChatDrawer、数字人模式框架
- [x] **对话 API** — `/api/chat` 关键词检索 + RAG + 引用来源 + 每日限额
- [x] **巴菲特人格 Prompt** — 提取到 `src/lib/prompts/buffett.ts`，思维框架 + 说话风格 (9567430)
- [x] **SSE Streaming** — 对话逐字流式输出，感知延迟 ~10s → ~0.5s (e4bfaba)
- [x] **可配置免费次数** — `FREE_DAILY_CHAT_LIMIT` 环境变量，默认 30 (e4bfaba)

---

## 🔥 P0：混合检索系统

> 详细设计见 DESIGN.md

### 基础设施
- [ ] Supabase 开启 pgvector 扩展（`CREATE EXTENSION vector`）
- [ ] Section 表新增 `embedding` 字段（`vector(1536)`）
- [ ] Section 表新增 `searchVector` 字段（`tsvector`，基于 `contentEn`）
- [ ] 创建 HNSW 索引（embedding）和 GIN 索引（searchVector）
- [ ] Prisma migration

### Embedding 生成
- [ ] 新建 `scripts/generate-embeddings.ts`
- [ ] 调用 AI API embedding 端点，为全量 Section 生成 embedding
- [ ] 支持增量更新（跳过已有 embedding 的段落）
- [ ] 运行脚本，验证全量生成完成

### 检索逻辑改造
- [ ] 新建 `src/lib/search.ts` — 混合检索模块
- [ ] 实现 Query 翻译（中文 → 英文，复用现有 AI API）
- [ ] 实现向量检索路（query embedding → cosine similarity → top 10）
- [ ] 实现关键词检索路（translated query → tsvector @@ plainto_tsquery → top 10）
- [ ] 实现合并排序（score = 0.7 × vector + 0.3 × keyword → top 5）
- [ ] 替换 `route.ts` 中的 `retrieveRelevantSections`

### 验证
- [ ] 对比测试：关键词匹配 vs 混合检索，用 10 个典型问题评估召回质量
- [ ] 性能测试：混合检索延迟 < 200ms

---

## 🔥 当前冲刺：Phase 1 — 全量数据结构化

### 数据扩展
- [ ] 修改 `fetch_letters.py` 支持 1965-2019 全部信件下载
- [ ] 适配早期信件格式差异（HTML vs PDF vs 扫描件）
- [ ] 修改 `parse_pdf_sections.py` 适配不同年份 PDF 格式
- [ ] 批量翻译全部年份，支持断点续传
- [ ] 修改 `prisma/seed.ts` 支持导入全部 59 个年份

### Schema 扩展
- [ ] 新增 `Topic` 模型（主题标签）
- [ ] 新增 `CompanyMention` 模型（公司提及，关联 Section）
- [ ] 新增 `SectionTopic` 模型（段落-主题关联）
- [ ] 运行 `npx prisma migrate dev`

### AI 标注
- [ ] 新建 `scripts/parsing/annotate_sections.py`
- [ ] AI 提取每段落提及的公司（公司名 + ticker）
- [ ] AI 提取每段落的主题标签
- [ ] 标注结果写入数据库
- [ ] 抽样审查标注质量

---

## 📋 后续 Phase（不在当前冲刺）

### Phase 2: 对话引擎 + 探索
- [ ] 主题时间线 API（输入公司/主题 → 返回相关段落时间线）
- [ ] 主题时间线页面 `/explore`（复用混合检索 + 年份分组展示）
- [ ] 对话记忆 — 多轮对话上下文优化

### Phase 3: 虚拟人
- [ ] 虚拟人 API 选型（HeyGen / D-ID / 开源）
- [ ] 声音方案选型（ElevenLabs / 其他）
- [ ] 对话页面升级 — 视频模式
- [ ] 延迟优化 + 成本控制

### Phase 4: 打磨
- [ ] 年度背景卡片（YearContext 模型 + 组件）
- [ ] 段落级公司上下文面板
- [ ] 翻译质量修复
- [ ] 测试覆盖率 >80%

---

## 🔍 待调研

- [ ] 虚拟人 API 效果评估（HeyGen / D-ID 免费额度测试）
- [ ] 声音克隆合规性（真实声音 vs 类似风格通用声音）
- [ ] 早期信件（1965-1977）格式调研 — 是否需要 OCR
- [x] ~~向量搜索 vs 关键词匹配 — 对话引擎检索方案~~ → 见 DESIGN.md，采用混合检索

---

## QA 积压

- [ ] 扩展年份导航 — 2020-2023 年信件翻译与导入
- [ ] 优化浏览器返回按钮行为
