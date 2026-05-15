import type { CanvasState, RightLens } from '@/types/canvas'

export const VALUE_FRAMEWORK_LENSES: RightLens[] = [
  {
    title: 'Right Business',
    buffett: '寻找"wonderful company"，具有持久竞争优势（护城河）、可预测的长期现金流、高ROE、简单易懂的商业模式。强调"长长的坡，厚厚的雪"——好生意比好价格更重要。',
    liLu: '好的生意模式就是能长期产生很多净现金流的模式。Right Business 最重要，因为它能让 Right People 充分体现价值，重点看企业长期生命力与竞争优势。',
    duanYongping: 'Right Business 就是生意模式（赚钱的方式）。喜欢强大的商业模式：能持续产生现金、消费者导向、本分。不喜欢生意模式就不会继续看下去。',
    consensus: '好生意的本质：用最少的再投资，持续产生大量自由现金流。护城河是这种能力的结构性保障，也是三人最核心的共同判断标准。',
    keyQuestions: [
      '十年后这家公司的护城河会更宽还是更窄？',
      '业务赚的是真现金，还是只有会计利润？',
      '如果你是创始人，你愿意一辈子只经营这一家公司吗？',
    ],
  },
  {
    title: 'Right People',
    buffett: '管理层必须 honest、competent、shareholder-oriented。只与喜欢、信任、钦佩的人共事。好的管理层能"造钟"（建体系）而非仅"报时"（靠个人）。',
    liLu: '关注管理层的诚信、能力与长期视野。Right People 在好生意中能充分体现价值；强调企业家特质和第一性原理思考能力。',
    duanYongping: 'Right People 指企业文化（与创始人高度相关）。诚信、本分、消费者导向的文化最重要——文化好能长期支撑生意模式。',
    consensus: '诚信是底线，资本配置能力是关键。文化与创始人高度绑定，没有好文化，再好的生意模式也会被人败掉。',
    keyQuestions: [
      '管理层历史上如何对待少数股东？',
      '有没有把股东的钱用于无关收购或过度多元化？',
      '没有创始人之后，公司文化能否自我传承？',
    ],
  },
  {
    title: 'Right Price',
    buffett: '优选"wonderful company at a fair price"而非"fair company at a wonderful price"。以合理价格买入并长期持有，让复利而非短期价差创造价值。',
    liLu: '安全边际重要，但相对于 Right Business 和 Right People 没那么关键。重点是内在价值与长期现金流折现，而非短期市场波动。',
    duanYongping: 'Price 没有那么重要，Business 和 People 最重要。只要前两者好，就等"过得去的价格"。要从未来看回来判断今天是否是好价钱。',
    consensus: '安全边际是价格与价值之间的缓冲。好生意可以容忍更高的价格——Business 和 People 足够好时，Price 反而是三者中最不关键的。',
    keyQuestions: [
      '以当前价格持有十年，年化回报率合理吗？',
      '如果股价明天腰斩，你有信心加仓还是会恐慌卖出？',
      '你买的是价值本身，还是在赌别人以更高价接盘？',
    ],
  },
]

export function makeFrameworkDefaultCanvas(): CanvasState {
  return {
    cards: [
      {
        type: 'value_framework',
        status: 'done',
        summary: '先看生意、再看人、最后看价格。',
        lenses: VALUE_FRAMEWORK_LENSES,
      },
      {
        type: 'company_snapshot',
        status: 'pending',
        basicInfo: [],
        financialMetrics: [],
        businessModel: [],
        culture: [],
        priceTrend: [],
      },
    ],
    decision: 'watch',
    openQuestions: [],
  }
}

export const POPART_MOCK: CanvasState = {
  cards: [
    {
      type: 'master_framework',
      status: 'pending',
      summary: '',
      dimensions: [],
    },
    {
      type: 'holding_behavior',
      status: 'pending',
      signal: '',
      facts: [],
    },
    {
      type: 'business_quality',
      status: 'pending',
      headline: '',
      bullets: [],
      metrics: [],
    },
    {
      type: 'company_overview',
      status: 'pending',
      name: '泡泡玛特',
      ticker: '09992.HK',
      market: 'hk',
      sector: undefined,
      businessModel: undefined,
    },
    {
      type: 'financial_facts',
      status: 'pending',
      period: undefined,
      metrics: [],
    },
    {
      type: 'right_business',
      status: 'done',
      conclusion: '业务可理解，护城河存在但持久性存疑',
      supporting: [
        'IP + 盲盒模型简单可理解：创造稀缺感与惊喜感，驱动重复购买',
        'Molly、Labubu 等 IP 知名度高，具备初步品牌溢价（毛利率 62%）',
        '海外扩张路径清晰，东南亚布局有序推进',
      ],
      counter: [
        'IP 生命周期短，单一 IP 热度衰减快，需持续推出新 IP 维持增长',
        '商业模式门槛较低，竞争者可复制核心玩法（泡泡玛特之后已出现多家跟随者）',
        '收藏属性依赖潮流，文化扩散能力仍未验证',
      ],
      confidence: 0.62,
    },
    {
      type: 'right_people',
      status: 'done',
      conclusion: '创始人专注度高，资本分配历史尚短',
      supporting: [
        '创始人王宁深度参与 IP 孵化，核心业务高度专注',
        '上市以来未见重大资本乱用，分红与回购政策合理',
      ],
      counter: [
        '上市时间较短（2020），长期资本分配能力有待验证',
        '管理团队国际化经验不足，海外扩张可能面临挑战',
      ],
      confidence: 0.55,
    },
    {
      type: 'right_price',
      status: 'pending',
      conclusion: '',
      supporting: [],
      counter: [],
      confidence: 0,
    },
    { type: 'master_mentions', status: 'pending', mentions: [] },
  ],
  decision: 'watch',
  openQuestions: [],
}

export function makeSkeletonCanvas(
  name: string,
  ticker: string,
  market: 'us' | 'hk' | 'a',
): CanvasState {
  return {
    cards: [
      {
        type: 'value_framework',
        status: 'done',
        summary: '先看生意、再看人、最后看价格。',
        lenses: VALUE_FRAMEWORK_LENSES,
      },
      {
        type: 'company_snapshot',
        status: 'pending',
        basicInfo: [
          { label: '公司', value: name || '—' },
          { label: 'Ticker', value: ticker || '—' },
          { label: '市场', value: market.toUpperCase() },
        ],
        financialMetrics: [],
        businessModel: [],
        culture: [],
        priceTrend: [],
      },
      { type: 'company_overview', status: 'pending', name, ticker, market },
      { type: 'financial_facts', status: 'pending', period: undefined, metrics: [] },
      { type: 'right_business', status: 'pending', conclusion: '', supporting: [], counter: [], confidence: 0 },
      { type: 'right_people', status: 'pending', conclusion: '', supporting: [], counter: [], confidence: 0 },
      { type: 'right_price', status: 'pending', conclusion: '', supporting: [], counter: [], confidence: 0 },
    ],
    decision: 'watch',
    openQuestions: [],
  }
}
