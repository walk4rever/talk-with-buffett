# TODOS — 当前工作队列

> 对应 PLAN.md Phase 1: 年份导航

## 当前冲刺

- [x] **主页改为年份列表** (Task 1.1) (32be0be)
  - 改造 `src/app/page.tsx`：查询所有 Letter，按年份降序
  - 年份卡片：年份、标题、段落数，点击跳转 `/letters/[year]`
  - 空数据时展示引导状态
  - 测试：列表渲染、空数据空状态
  - CSS：`.year-grid` `.year-card` `.empty-state` 样式

- [x] **动态信件页面** (Task 1.2) (32be0be)
  - 新建 `src/app/letters/[year]/page.tsx`
  - 迁移现有 `page.tsx` 信件展示逻辑
  - 参数校验：非数字或不存在的 year → 404
  - 返回导航链接
  - 测试：正常渲染、year 不存在 404

- [x] **数据验证** (Task 1.3 部分) (32be0be)
  - seed 导入 2024 年 54 段成功
  - `npm run build` 通过，路由正确
  - 8 个测试全部通过
  - 2020-2023 翻译留待下个对话

## 积压（评审中识别，暂不执行）

- [ ] 翻译 2020-2023 四年信件（下个对话）
- [ ] AI 分析接口接入真实 API（Phase 4 后）
- [ ] 翻译质量修复：2024 短文本/标题校对（Phase 4）
