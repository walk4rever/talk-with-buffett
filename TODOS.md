> 🔒 内部文件，不对外公开。

# TODOS — 当前工作队列

> 检索架构详见 DESIGN.md

## ✅ 已完成

- [x] **主页改为年份列表** (32be0be)
- [x] **动态信件页面** `/letters/[year]` (32be0be)
- [x] **数据验证** — seed 导入 2024 年 54 段，8 个测试全部通过
- [x] **P0 修复** — 移动端响应式、AI 分析加载状态
- [x] **P1 修复** — 暗黑模式持久化、高亮持久性
- [x] **P2 修复** — 页脚信息、错误边界
- [x] **UI 设计** — 极简主页、阅读页、ChatDrawer、数字人模式框架
- [x] **对话 API** — `/api/chat` 检索 + RAG + 引用来源 + 每日限额
- [x] **巴菲特人格 Prompt** — `src/lib/prompts/buffett.ts`
- [x] **SSE Streaming** — 对话逐字流式输出 (e4bfaba)
- [x] **可配置免费次数** — `FREE_DAILY_CHAT_LIMIT` 环境变量
- [x] **混合检索** — tsvector + pgvector (1024-dim HNSW)
- [x] **Markdown 渲染** — 对话中 AI 回复用 react-markdown 渲染
- [x] **字体升级** — Lora + Noto Serif SC + Inter
- [x] **引用重构** — 后端主导引用 via [来源N] 标记，杜绝幻觉

---

## 🔥 P0：Markdown 数据重构

> 详细设计见 DESIGN.md

### 1. 拉取数据
- [ ] 从 GitHub pzponge/Yestoday 下载 60 个 markdown 文件（1965-2024）
- [ ] 存放到 `data/letters/` 目录

### 2. 数据库迁移
- [ ] Letter 表新增 `contentMd` 字段（TEXT，存完整 markdown）
- [ ] 新建 Chunk 表（替代 Section）：`id, letterId, order, title, contentEn, contentZh, embedding, searchVector`
- [ ] Prisma migration

### 3. 导入脚本
- [ ] 新建 `scripts/import-markdown.ts`
- [ ] 读取每个 md 文件 → 写入 `Letter.contentMd`
- [ ] 按 `## / #` 标题切分，无标题的按段落切分
- [ ] 分离中英文（CJK 字符检测）
- [ ] 写入 Chunk 表
- [ ] 对 `contentEn` 生成 embedding (1024-dim) + tsvector

### 4. 代码适配
- [ ] `src/lib/search.ts` — Section → Chunk
- [ ] `src/lib/prompts/buffett.ts` — Section → Chunk
- [ ] `src/app/api/chat/route.ts` — Section → Chunk
- [ ] 阅读页重构 — 从 `Letter.contentMd` 直接渲染 markdown
- [ ] 去掉 DualColumnReader（取消双栏模式）
- [ ] 保留单语过滤（EN / 中文模式：渲染时按段落语言过滤）

### 5. 清理
- [ ] 删除 Section 表（migration）
- [ ] 删除旧的 parse/translate 脚本
- [ ] 删除 DualColumnReader 组件

### 6. 验证
- [ ] 阅读页展示正确（markdown 表格、标题、格式）
- [ ] 对话检索正常（引用卡片出现）
- [ ] 对比检索质量：准备 10 个测试问题，对比新旧方案召回率

---

## 📋 后续 Phase

### Phase 2: 对话体验增强
- [ ] 引用点击 → 分屏阅读 + 高亮（桌面分屏，移动端抽屉）
- [ ] 对话记忆 — 多轮对话上下文优化
- [ ] AI 无 [来源N] 标记时的降级策略

### Phase 3: 探索与发现
- [ ] 主题时间线 API（公司/主题 → 相关段落时间线）
- [ ] 探索页面 `/explore`（混合检索 + 年份分组）
- [ ] AI 标注：公司提及 + 主题标签

### Phase 4: 虚拟人
- [ ] 虚拟人 API 选型（HeyGen / D-ID / 开源）
- [ ] 声音方案选型
- [ ] 对话页面升级 — 视频模式
- [ ] 延迟优化 + 成本控制

### Phase 5: 打磨
- [ ] 年度背景卡片
- [ ] 测试覆盖率 >80%
- [ ] SEO 优化

---

## 🔍 待调研

- [ ] 虚拟人 API 效果评估
- [ ] 声音克隆合规性
