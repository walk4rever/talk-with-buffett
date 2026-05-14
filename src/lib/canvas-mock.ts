import type { CanvasState } from '@/types/canvas'

export const POPART_MOCK: CanvasState = {
  cards: [
    {
      type: 'company_overview',
      status: 'done',
      name: '泡泡玛特',
      ticker: '09992.HK',
      market: 'hk',
      sector: '消费 / 潮玩',
      businessModel:
        '通过潮玩 IP（Molly、Labubu 等）驱动的盲盒零售，靠惊喜感与收藏属性创造高复购率',
    },
    {
      type: 'financial_facts',
      status: 'done',
      period: '2023A / TTM',
      metrics: [
        { label: '营收', value: 'HK$93亿', trend: 'up', note: '+38% YoY' },
        { label: '毛利率', value: '62%', trend: 'flat', note: '近三年稳定' },
        { label: '净利率', value: '18%', trend: 'up' },
        { label: 'ROIC', value: '23%', trend: 'up', note: '显著高于行业' },
        { label: '自由现金流', value: '正向', trend: 'up', note: '持续为正' },
        { label: 'ROE', value: '28%', trend: 'flat' },
        { label: '资产负债率', value: '31%', trend: 'flat', note: '低杠杆' },
      ],
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
    {
      type: 'master_mentions',
      status: 'done',
      mentions: [
        {
          master: '巴菲特',
          year: 2007,
          excerpt:
            '真正伟大的消费品公司拥有一种近乎无形的资产——它让消费者反复回来，即使竞争对手提供更低的价格。',
          sourceType: 'shareholder',
        },
        {
          master: '段永平',
          year: 2021,
          excerpt:
            '好的生意模式是那种你不用每天做决策的，IP 生意有个特点就是你不知道下一个爆款是什么。',
          sourceType: 'post',
        },
      ],
    },
  ],
  decision: 'research',
  openQuestions: [
    'IP 矩阵长期粘性如何？Molly 之外，下一个大 IP 是什么？',
    '海外扩张能否复制国内模式？文化差异影响有多大？',
    '当前估值对应的内在价值区间是多少？安全边际是否充足？',
  ],
  references: [
    {
      sourceType: 'shareholder',
      master: '巴菲特',
      year: 2007,
      title: '2007 致股东信',
      excerpt: '真正伟大的消费品公司拥有一种近乎无形的资产——它让消费者反复回来，即使竞争对手提供更低的价格。',
    },
    {
      sourceType: 'post',
      master: '段永平',
      year: 2021,
      title: '雪球问答 · 2021',
      excerpt: '好的生意模式是那种你不用每天做决策的，IP 生意有个特点就是你不知道下一个爆款是什么。',
    },
    {
      sourceType: 'shareholder',
      master: '巴菲特',
      year: 1999,
      title: '1999 致股东信',
      excerpt: '我们对任何依赖持续创新维持竞争优势的公司都保持谨慎——历史表明，这类护城河往往比看起来更脆弱。',
    },
  ],
}

export function makeSkeletonCanvas(
  name: string,
  ticker: string,
  market: 'us' | 'hk' | 'a',
): CanvasState {
  return {
    cards: [
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
