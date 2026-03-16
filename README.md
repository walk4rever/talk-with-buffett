# Learn from Buffett

一个现代化的巴菲特致股东信阅读与学习平台。逐段拆解、中英双语对照、AI 深度解析 — 让每一封信都读透。

> "我大概六岁的时候就开始阅读关于投资的一切。" — 沃伦·巴菲特

## 为什么做这个？

巴菲特的股东信是价值投资的圣经，但原版 PDF 读起来门槛不低：纯英文、长篇幅、金融术语密集。这个项目把信件拆成段落、配上中文翻译、接入 AI 分析，让中文读者也能高效学习大师智慧。

## 当前状态

🟢 **MVP 开发中** — 核心阅读功能已可用，正在构建年份导航和双语切换。

### ✅ 已实现
- 段落化阅读（2024 年信件，53 个段落）
- 中英双语并排展示
- AI Deep Dive 分析（按段落触发）
- 文本高亮标注（登录后可用，三色可选）
- GitHub / Google 登录认证
- 暗黑模式支持
- 移动端响应式布局

### 🚧 开发中
- 年份列表与导航（2020-2024 信件数据已就绪）
- 双语显示切换开关
- 响应式细节打磨

### 📋 规划中
- 个人笔记功能
- 社交分享卡片生成
- 更多年份信件（历史信件回溯）
- 加载性能优化

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

信件 PDF 来自 [Berkshire Hathaway 官方网站](https://www.berkshirehathaway.com/letters.html)，仅供学习研究使用。

## License

MIT
