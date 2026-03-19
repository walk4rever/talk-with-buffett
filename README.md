# Talk with Buffett

与巴菲特对话 — 不只是读信，而是跟他坐在同一个房间里，探讨一家公司、一个主题、一段投资哲学。

> "我大概六岁的时候就开始阅读关于投资的一切。" — 沃伦·巴菲特

## 为什么做这个？

巴菲特的股东信是价值投资的圣经，但大多数人的读法是错的：脱离历史背景读一封信，就像脱离棋局看一步棋 — 你知道他走了什么，但不知道他为什么这么走。

**Learn from Buffett 的终极愿景：**

```
  普通阅读                              与巴菲特对话
  ┌────────────────┐                   ┌────────────────────────────────────┐
  │ 一段英文        │                   │  [巴菲特虚拟人物]                   │
  │ 一段翻译        │                   │                                    │
  │ ...重复50次     │                   │  你："你怎么看 NVIDIA？"            │
  │                │                   │                                    │
  │ 读完了，然后呢？ │                   │  💬 "我不投资我不懂的东西...         │
  └────────────────┘                   │     让我告诉你 1999 年互联网泡沫     │
                                       │     的时候我是怎么想的"              │
                                       │                                    │
                                       │  [引用来源：1999 年股东信]           │
                                       └────────────────────────────────────┘
```

## 产品方向

### 🎯 核心体验：与巴菲特对话
- 输入一家公司或一个主题 → 巴菲特虚拟人物与你对话
- 回答基于 1965-2024 全部信件的结构化知识，不是空话
- 每个回答标注来源（年份/信件/股东大会），可追溯
- 虚拟人物视频 + 声音的沉浸式体验

### 📖 沉浸式阅读（已实现）
- 逐段拆解，中英双语对照
- 段落级 AI 深度解析
- 文本高亮标注 + 个人笔记

### 🕰️ 时代背景
- **年度背景卡片：** 每封信配有当年标普收益率、伯克希尔股价、重大事件
- **段落级上下文：** 信中提到具体公司时，展示该公司当年关键数据
- **持仓变动：** 基于 SEC 13F 公开数据，展示伯克希尔当年买了什么、卖了什么

### 🔗 主题时间线
- 输入公司或主题 → 从所有信件中检索相关段落，按时间线展示
- 投资案例追踪（从买入到持有到卖出的完整故事）
- 对比模式：Apple vs Microsoft，看他怎么评价两家公司

## 当前状态

🟢 **Phase 1 已完成，Phase 2 规划中**

### ✅ 已实现
- 段落化阅读（2024 年信件，53 个段落）
- 中英双语并排展示
- AI Deep Dive 分析（按段落触发）
- 文本高亮标注（登录后可用，三色可选）
- GitHub / Google 登录认证
- 年份列表与动态信件页面导航
- 暗黑模式 + 移动端响应式

### 🚧 下一步：全量数据结构化 + 对话引擎
详见 [PLAN.md](./PLAN.md) 和 [TODOS.md](./TODOS.md)

## 实现路径（三步走）

```
  第 1 步：数据结构化（知识库）
    1965-2024 全部信件 → 段落级结构化
    主题标签 + 公司提及标注
    ↓
  第 2 步：对话引擎（灵魂）
    RAG 检索 → AI 生成"巴菲特式"回答
    文字界面先跑通
    ↓
  第 3 步：虚拟人（身体）
    视频生成 API（HeyGen / D-ID）
    声音克隆（ElevenLabs）
    视频 + 音频同步
```

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Next.js 16 (App Router, TypeScript) |
| UI | React 19 + CSS Modules / Vanilla CSS |
| 数据库 | SQLite + Prisma ORM |
| 认证 | NextAuth.js (GitHub, Google) |
| AI 分析 | OpenAI 兼容 API（默认 MiniMax-M2.5 via DashScope） |
| 翻译管道 | Python (pdfplumber + OpenAI API) |
| 虚拟人 | HeyGen / D-ID（待选型） |
| 声音 | ElevenLabs（待选型） |
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
│   ├── page.tsx                  # 主页（年份列表）
│   ├── letters/[year]/page.tsx   # 信件阅读页
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
