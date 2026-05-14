export type CardStatus = 'pending' | 'streaming' | 'done'
export type DecisionStatus = 'watch' | 'research' | 'buy' | 'hold' | 'pass'
export type Market = 'us' | 'hk' | 'a'
export type MetricTrend = 'up' | 'down' | 'flat'

export interface CompanyOverviewCard {
  type: 'company_overview'
  status: CardStatus
  name: string
  ticker: string
  market: Market
  sector?: string
  businessModel?: string
}

export interface FinancialMetric {
  label: string
  value: string
  trend?: MetricTrend
  note?: string
}

export interface FinancialFactsCard {
  type: 'financial_facts'
  status: CardStatus
  period?: string
  metrics: FinancialMetric[]
}

export interface AnalysisCard {
  type: 'right_business' | 'right_people' | 'right_price'
  status: CardStatus
  conclusion: string
  supporting: string[]
  counter: string[]
  confidence: number
}

export interface MasterMentionItem {
  master: string
  year: number
  excerpt: string
  sourceType: string
}

export interface MasterMentionsCard {
  type: 'master_mentions'
  status: CardStatus
  mentions: MasterMentionItem[]
}

export type CanvasCard =
  | CompanyOverviewCard
  | FinancialFactsCard
  | AnalysisCard
  | MasterMentionsCard

export interface CanvasReference {
  sourceType: string
  master: string
  year: number
  title?: string
  excerpt?: string
}

export interface CanvasState {
  cards: CanvasCard[]
  decision: DecisionStatus
  openQuestions: string[]
  references?: CanvasReference[]
}
