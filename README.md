# Learn from Buffett

穿越式阅读巴菲特致股东信 — 不只是读信，而是回到那个时代，看见他做决策时的市场、持仓和世界。

> "我大概六岁的时候就开始阅读关于投资的一切。" — 沃伦·巴菲特

## 为什么做这个？

巴菲特的股东信是价值投资的圣经，但大多数人的读法是错的：脱离历史背景读一封信，就像脱离棋局看一步棋 — 你知道他走了什么，但不知道他为什么这么走。

**Learn from Buffett 要解决的问题：**

```
  普通阅读                              穿越式阅读
  ┌────────────────┐                   ┌────────────────────────────────────┐
  │ 一段英文        │                   │ 一段英文              │ 时代背景    │
  │ 一段翻译        │                   │ 一段翻译              │ 标普走势    │
  │ ...重复50次     │                   │                      │ 伯克希尔股价 │
  │                │                   │ "我们买入了           │ OXY 当年走势 │
  │ 读完了，然后呢？ │                   │  Occidental"         │ 油价背景    │
  └────────────────┘                   │                      │ 持仓变动    │
                                       │ 读完了，你理解了为什么  │            │
                                       └────────────────────────────────────┘
```

## 核心功能

### 📖 沉浸式阅读
- 逐段拆解，中英双语对照
- 段落级 AI 深度解析
- 文本高亮标注 + 个人笔记

### 🕰️ 时代背景（核心差异化）
- **年度背景卡片：** 每封信配有当年标普收益率、伯克希尔股价、2-3 条重大事件
- **段落级上下文：** 信中提到具体公司时，侧边栏展示该公司当年关键数据和股价走势
- **持仓变动：** 基于 SEC 13F 公开数据，展示伯克希尔当年买了什么、卖了什么

### 🔗 跨年份追踪（远期目标）
- 按主题串联多年信件（如"巴菲特历年谈保险"）
- 投资案例追踪（从买入到持有到卖出的完整故事）
- 投资原则知识图谱

## 当前状态

🟢 **MVP 开发中**

### ✅ 已实现
- 段落化阅读（2024 年信件，53 个段落）
- 中英双语并排展示
- AI Deep Dive 分析（按段落触发）
- 文本高亮标注（登录后可用，三色可选）
- GitHub / Google 登录认证
- 暗黑模式 + 移动端响应式

### 🚧 下一步：时代背景 MVP
- [ ] 年度背景卡片（标普走势、伯克希尔股价、年度大事件）
- [ ] 年份列表与导航（2020-2024 信件数据已就绪）
- [ ] 段落级公司上下文面板

### 📋 规划中
- 持仓变动数据（SEC 13F）
- 跨年份主题串联
- 社交分享卡片
- 更多年份信件（1965-2019 回溯）

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Next.js 16 (App Router, TypeScript) |
| UI | React 19 + CSS Modules / Vanilla CSS |
| 数据库 | SQLite + Prisma ORM |
| 认证 | NextAuth.js (GitHub, Google) |
| AI 分析 | OpenAI 兼容 API（默认 MiniMax-M2.5 via DashScope） |
| 翻译管道 | Python (pdfplumber + OpenAI API) |
| 测试 | Vitest |

## 数据管道

信件从 PDF 到数据库经过 4 步处理：

```
  berkshirehathaway.com          data/letters/           data/parsed/{year}/
  ┌──────────────┐    fetch     ┌──────────────┐  parse  ┌──────────────┐
  │  PDF 原文     │ ─────────▶  │  .pdf 文件    │ ──────▶ │ sections.json│
  └──────────────┘              └──────────────┘         └──────┬───────┘
                                                                │ translate
                                                                ▼
                                    dev.db               sections_zh.json
                                ┌──────────────┐  seed   ┌──────────────┐
                                │  SQLite DB    │ ◀────── │ 中英双语段落  │
                                └──────────────┘         └──────────────┘
```

对应脚本：
1. **下载 PDF：** `python scripts/crawler/fetch_letters.py`
2. **解析段落：** `python scripts/crawler/parse_pdf.py`
3. **AI 翻译：** `python scripts/crawler/translate_sections.py`（需要 AI API Key）
4. **导入数据库：** `npx prisma db seed`

## 快速开始

### 环境要求
- Node.js 18+
- Python 3.10+

### 1. 安装依赖

```bash
# Node.js 依赖
npm install

# Python 依赖
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r scripts/crawler/requirements.txt
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入你的 API Key 和认证配置
```

### 3. 初始化数据库

```bash
npx prisma migrate dev
```

### 4. 准备信件数据

如果你只想快速体验，项目已包含 2024 年的解析数据（`data/parsed/2024/`），可直接导入：

```bash
npx prisma db seed
```

如果你想从头处理完整管道：

```bash
source venv/bin/activate

# 下载 PDF（2020-2024）
python scripts/crawler/fetch_letters.py

# 解析为段落
python scripts/crawler/parse_pdf.py

# AI 翻译（需要 AI_API_KEY）
python scripts/crawler/translate_sections.py

# 导入数据库
npx prisma db seed
```

### 5. 启动开发服务器

```bash
npm run dev
# 打开 http://localhost:3000
```

## 项目结构

```
src/
├── app/
│   ├── page.tsx                  # 主页（当前展示 2024 信件）
│   ├── layout.tsx                # 全局布局
│   ├── globals.css               # 全局样式
│   └── api/
│       ├── ai-analysis/route.ts  # AI 深度分析接口
│       ├── highlights/route.ts   # 高亮标注接口
│       └── auth/[...nextauth]/   # 认证接口
├── components/
│   ├── SectionCard.tsx           # 段落卡片（双语、高亮、AI分析）
│   ├── Header.tsx                # 顶部导航
│   └── Providers.tsx             # Session Provider
└── lib/
    ├── prisma.ts                 # Prisma 客户端
    └── auth.ts                   # NextAuth 配置

scripts/crawler/
├── fetch_letters.py              # 下载股东信 PDF
├── parse_pdf.py                  # PDF 解析为段落
└── translate_sections.py         # AI 中文翻译

prisma/
├── schema.prisma                 # 数据模型
└── seed.ts                       # 数据导入脚本

data/
├── letters/                      # 原始 PDF 文件
└── parsed/{year}/                # 解析后的 JSON 数据
```

## 开发命令

```bash
npm run dev            # 启动开发服务器
npm run build          # 生产构建
npm run lint           # ESLint 检查
npm run test           # 运行测试
npm run test:coverage  # 测试覆盖率
```

## 数据来源

- 信件 PDF：[Berkshire Hathaway 官方网站](https://www.berkshirehathaway.com/letters.html)
- 市场数据：Yahoo Finance（标普500、伯克希尔股价、个股数据）
- 持仓数据：SEC EDGAR（13F 季度持仓报告）

仅供学习研究使用。

## License

MIT
