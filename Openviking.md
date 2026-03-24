# OpenViking 全量替换设计（DESIGN.openviking）

## 1. 背景与目标

当前项目对话检索依赖 PostgreSQL（Supabase）内的 `tsvector + pgvector` 方案。我们已经决定在 `openviking` 分支执行一次完整的检索架构迁移：

- 用 OpenViking 替换 Supabase 检索链路（全量替换检索，不做长期双写）
- 数据导入源从数据库改为 `data/` 目录（文件真源）
- 保留现有对话体验、引用展示和工作区跳转能力
- 支持未来部署到 Vercel（Next.js 在 Vercel，OpenViking 独立部署）

本设计文档定义迁移后的目标架构、实施步骤、兼容策略、风险与回滚方案。

## 2. 非目标（明确不做）

- 不将 OpenViking 打包进 Next.js 项目运行时
- 不在 Vercel Functions 内运行 OpenViking 服务
- 不导入 `html/pdf` 资源（本期仅导入 markdown）
- 不保留旧 Supabase 检索为长期主备双活

## 3. 决策摘要

1. 检索层主引擎：OpenViking HTTP API（`/api/v1/search/search`）
2. 数据真源：`data/` 目录中的 markdown 文件
3. `chunkId` 策略：基于 `uri` 生成稳定 ID（不再依赖 DB chunk id）
4. 部署拓扑：
   - Next.js：Vercel
   - OpenViking：独立服务（VPS/容器平台）
5. 迁移原则：先可运行、再清理旧链路，避免一次改动过大

## 4. 目标架构

### 4.1 运行时架构

- 用户 -> `POST /api/chat`（Next.js）
- Next.js 调用 `searchChunks()`
- `searchChunks()` 调用 OpenViking `search/search`
- 返回结果映射为现有 `RetrievedChunk`（兼容 prompt 与 sources UI）
- Next.js 继续调用 LLM API 生成回答（此层暂不替换）

### 4.2 组件职责

- `src/lib/openviking.ts`：
  - OpenViking HTTP 调用封装
  - 鉴权头、超时、错误归一化
  - 响应对象到内部检索结构转换
- `src/lib/search.ts`：
  - 保留 Query Understanding（intent/year/entity）
  - 检索执行改为 OpenViking
  - 排序、年份去重、最终 topN 裁剪仍在应用层
- `scripts/sync-openviking.ts`（新增）：
  - 从 `data/` 扫描 markdown
  - 规范化路径并导入 OpenViking
  - 支持增量同步（按文件 hash 或 mtime）

## 5. 数据导入设计（data/ -> OpenViking）

### 5.1 导入范围

- 包含：`data/**/*.md`
- 忽略：`data/**/*.html`, `data/**/*.pdf`

### 5.2 资源 URI 规范

建议目标 URI：

- `viking://resources/{sourceType}/{year}/{docSlug}/{relativePath}.md`

其中：

- `sourceType`：`shareholder | partnership | annual_meeting | article | interview | unknown`
- `year`：四位年份；解析失败时 `0000`
- `docSlug`：基于文件名和目录生成稳定 slug
- `relativePath`：保留必要子路径，减少同名冲突

### 5.3 元数据策略

从路径和文件名解析：

- `sourceType`
- `year`
- `title`

若解析失败：

- `sourceType = article`
- `year = 0`
- `title = basename`

### 5.4 chunkId 策略

- `chunkId = sha1(uri)`（或等价稳定 hash）
- 所有引用链路以该值作为 `chunkId`
- 不再依赖 Supabase `Chunk.id`

## 6. 检索与映射设计

### 6.1 OpenViking 接口选择

- 首选：`POST /api/v1/search/search`
- 可选降级：`POST /api/v1/search/find`

请求最小集：

- `query`
- `target_uri`（默认 `viking://resources/`）
- `limit`

### 6.2 检索结果映射为 RetrievedChunk

将 OpenViking `resources[]` 映射为：

- `id` -> `chunkId`（hash(uri)）
- `year` -> 从 uri/metadata 解析
- `sourceType` -> 从 uri/metadata 解析
- `title` -> metadata 或 uri basename
- `contentEn` -> 先使用 `abstract`（本期），后续可加 `content/read` 提升片段质量
- `contentZh` -> `null`（本期）
- `score` -> OpenViking score
- `order` -> 映射后的顺序索引

### 6.3 时间线能力保留

虽然底层检索替换，以下能力保留在应用层：

- temporal intent 判定
- `asc/desc/relevance` 排序
- `distinctByYear` 去重
- `evidencePlan` 构建

## 7. API 与配置设计

### 7.1 新增环境变量

- `OPENVIKING_ENABLED=true`
- `OPENVIKING_URL=https://ov.your-domain.com`
- `OPENVIKING_API_KEY=xxx`
- `OPENVIKING_AGENT_ID=talk-with-buffett`
- `OPENVIKING_TARGET_URI=viking://resources/`
- `OPENVIKING_TIMEOUT_MS=12000`

### 7.2 兼容变量策略

- 迁移期保留旧 `AI_*`（用于 LLM）
- 检索相关 Supabase 参数标记为 deprecated
- 完成验收后移除旧检索依赖与注释

## 8. 部署设计（Vercel 目标）

### 8.1 生产部署拓扑

- Vercel：Next.js 应用
- OpenViking：独立主机/容器服务（持久化卷）
- 同步任务：CI 或手动触发脚本，将 `data/` 推送到 OpenViking

### 8.2 关键约束

- OpenViking 不能部署在 Vercel Serverless 函数中
- OpenViking 必须有持久化存储
- Vercel 到 OpenViking 使用 HTTPS + API Key

### 8.3 安全要求

- 启用 API Key 鉴权
- 限制来源（网关/IP allowlist 视部署平台能力）
- 不在前端暴露 OpenViking 密钥

## 9. 迁移计划（执行阶段）

### Phase A：接入骨架

- 新增 `src/lib/openviking.ts`
- 增加 `.env.example` 与配置解析
- 本地连通性检查（health + search smoke test）

### Phase B：数据导入

- 新增 `scripts/sync-openviking.ts`
- 首次全量导入 `data/**/*.md`
- 输出导入报告（成功/失败/跳过）

### Phase C：检索替换

- 重写 `src/lib/search.ts` 检索执行部分
- 保留 query understanding + 排序策略
- `/api/chat` 输出 sources 保持兼容

### Phase D：清理与收口

- 移除 Supabase 检索 SQL/embedding 逻辑
- 更新 README/PRODUCT/TODOS
- 添加回归测试与验收脚本

## 10. 验收标准

### 10.1 功能验收

- 对话可正常返回
- sources 卡片可显示并可跳转
- 时间线问题保持按年份展开能力
- 检索范围由 OpenViking 控制，结果可重复稳定

### 10.2 质量验收

- 30 个固定问题通过率不低于当前基线
- 引用命中率不低于当前基线
- P95 检索时延在可接受范围（目标 < 1.5s，视部署调整）

### 10.3 运维验收

- OpenViking 服务中断时给出明确降级错误
- 同步脚本支持幂等重跑
- 可观测日志包含 query、result_count、latency

## 11. 风险与应对

1. 风险：URI 无法稳定解析 year/sourceType
- 应对：导入时强制规范路径，解析失败打标并单独报告

2. 风险：abstract 过短影响回答质量
- 应对：二期增加 `content/read` 二次取文与 excerpt 抽取

3. 风险：OpenViking 网络波动影响在线请求
- 应对：超时控制 + 明确错误提示 + 可选短时缓存

4. 风险：一次性替换导致回归
- 应对：按 Phase 切换，保留短期回滚开关

## 12. 回滚策略

- 保留 `OPENVIKING_ENABLED` 开关
- 紧急情况：关闭开关，回退到旧检索实现（迁移窗口内保留）
- 回滚后保留导入数据，不影响后续再次切换

## 13. 待办清单（和实现绑定）

- [ ] 新增 `src/lib/openviking.ts`
- [ ] 新增 `scripts/sync-openviking.ts`
- [ ] 改造 `src/lib/search.ts` 为 OpenViking 检索
- [ ] 更新 `.env.example`（OpenViking 配置）
- [ ] 增加导入与检索 smoke test 脚本
- [ ] 更新 `README.md`、`PRODUCT.md`、`TODOS.md`

## 14. 里程碑定义

- M1：OpenViking 连通 + 单 query 检索成功
- M2：`data/` 全量 markdown 导入成功
- M3：`/api/chat` 已切换 OpenViking 检索并通过回归
- M4：移除 Supabase 检索代码并发布

---

本文件是 `openviking` 分支架构迁移的单一设计依据；实现细节以本文件为准，若有偏差须先更新本文件再改代码。
