export type CardStatus = 'pending' | 'streaming' | 'done'
export type DecisionStatus = 'watch' | 'research' | 'buy' | 'hold' | 'pass'
export type Market = 'us' | 'hk' | 'a'
export type MetricTrend = 'up' | 'down' | 'flat'
export type FrameworkLevel = 'strong' | 'medium' | 'weak'

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

export interface FrameworkDimension {
  key: 'moat' | 'management' | 'capital_allocation' | 'circle_of_competence' | 'valuation'
  label: string
  level: FrameworkLevel
  note: string
}

export interface MasterFrameworkCard {
  type: 'master_framework'
  status: CardStatus
  summary: string
  dimensions: FrameworkDimension[]
}

export interface RightLens {
  title: 'Right Business' | 'Right People' | 'Right Price'
  buffett: string
  liLu: string
  duanYongping: string
  consensus: string
  keyQuestions: string[]
}

export interface ValueFrameworkCard {
  type: 'value_framework'
  status: CardStatus
  summary: string
  lenses: RightLens[]
}

export interface HoldingBehaviorCard {
  type: 'holding_behavior'
  status: CardStatus
  asOf?: string
  signal: string
  facts: string[]
}

export interface BusinessQualityCard {
  type: 'business_quality'
  status: CardStatus
  headline: string
  bullets: string[]
  metrics: FinancialMetric[]
}

export interface TrendPoint {
  t: string
  v: number
}

export interface CompanySnapshotCard {
  type: 'company_snapshot'
  status: CardStatus
  basicInfo: Array<{ label: string; value: string }>
  financialMetrics: FinancialMetric[]
  businessModel: string[]
  culture: string[]
  priceTrend: TrendPoint[]
}

export type CanvasCard =
  | CompanyOverviewCard
  | FinancialFactsCard
  | AnalysisCard
  | MasterMentionsCard
  | MasterFrameworkCard
  | ValueFrameworkCard
  | HoldingBehaviorCard
  | BusinessQualityCard
  | CompanySnapshotCard

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
