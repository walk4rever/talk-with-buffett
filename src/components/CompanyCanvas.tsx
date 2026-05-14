"use client";

import { useState } from "react";
import type {
  CanvasState,
  AnalysisCard,
  CompanyOverviewCard,
  FinancialFactsCard,
  MasterMentionsCard,
  DecisionStatus,
  CanvasReference,
} from "@/types/canvas";

const TABS = [
  { key: "company_overview", label: "概览" },
  { key: "financial_facts",  label: "财务" },
  { key: "right_business",   label: "好生意" },
  { key: "right_people",     label: "好管理" },
  { key: "right_price",      label: "好价格" },
  { key: "judgment",         label: "研判" },
] as const;

type TabKey = typeof TABS[number]["key"];

const ANALYSIS_SUBTITLE: Record<string, string> = {
  right_business: "护城河 · 可理解性 · 持久性",
  right_people:   "资本分配 · 诚信 · 股东利益一致",
  right_price:    "内在价值 · 安全边际 · 赔率",
};

const DECISION_LABEL: Record<DecisionStatus, string> = {
  watch:    "观察",
  research: "研究中",
  buy:      "可建仓",
  hold:     "持有",
  pass:     "暂缓",
};

const MARKET_LABEL: Record<string, string> = {
  us: "美股",
  hk: "港股",
  a:  "A股",
};

const TREND_ARROW: Record<string, string> = {
  up:   "↑",
  down: "↓",
  flat: "→",
};

function confidenceColor(v: number): string {
  if (v >= 0.7) return "var(--up)";
  if (v >= 0.4) return "#f59e0b";
  return "var(--dn)";
}

function OverviewTab({ card }: { card: CompanyOverviewCard }) {
  if (card.status === "pending") {
    return (
      <div className="cc-tab-body">
        <div className="cc-overview--pending">
          <div className="cc-skeleton cc-skeleton--title" />
          <div className="cc-skeleton cc-skeleton--meta" />
          <div className="cc-skeleton cc-skeleton--body" />
        </div>
      </div>
    );
  }

  return (
    <div className="cc-tab-body">
      <div className="cc-overview-top">
        <span className="cc-overview-name">{card.name}</span>
        <div className="cc-overview-badges">
          <span className="cc-badge">{card.ticker}</span>
          {card.market && (
            <span className="cc-badge cc-badge--muted">{MARKET_LABEL[card.market]}</span>
          )}
          {card.sector && (
            <span className="cc-badge cc-badge--muted">{card.sector}</span>
          )}
        </div>
      </div>
      {card.businessModel && (
        <p className="cc-overview-model">{card.businessModel}</p>
      )}
    </div>
  );
}

function FinancialTab({ card }: { card: FinancialFactsCard }) {
  if (card.status === "pending" || card.metrics.length === 0) {
    return (
      <div className="cc-tab-body cc-tab-body--scroll">
        <div className="cc-metrics-grid cc-metrics-grid--skeleton">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="cc-metric-item">
              <div className="cc-skeleton cc-skeleton--metric-label" />
              <div className="cc-skeleton cc-skeleton--metric-value" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="cc-tab-body cc-tab-body--scroll">
      {card.period && <p className="cc-period-label">{card.period}</p>}
      <div className="cc-metrics-grid">
        {card.metrics.map((m, i) => (
          <div key={i} className="cc-metric-item">
            <span className="cc-metric-label">{m.label}</span>
            <span className="cc-metric-value">
              {m.value}
              {m.trend && (
                <span className={`cc-metric-trend cc-metric-trend--${m.trend}`}>
                  {TREND_ARROW[m.trend]}
                </span>
              )}
            </span>
            {m.note && <span className="cc-metric-note">{m.note}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalysisTab({
  card,
  mentions,
}: {
  card: AnalysisCard;
  mentions?: MasterMentionsCard;
}) {
  const subtitle = ANALYSIS_SUBTITLE[card.type];

  if (card.status === "pending") {
    return (
      <div className="cc-tab-body">
        {subtitle && <p className="cc-tab-subtitle">{subtitle}</p>}
        <div className="cc-skeleton cc-skeleton--line" style={{ marginBottom: 6 }} />
        <div className="cc-skeleton cc-skeleton--line cc-skeleton--short" />
      </div>
    );
  }

  if (card.status === "streaming") {
    return (
      <div className="cc-tab-body">
        {subtitle && <p className="cc-tab-subtitle">{subtitle}</p>}
        <div className="cc-streaming-dots">
          <span /><span /><span />
        </div>
      </div>
    );
  }

  return (
    <div className="cc-tab-body cc-tab-body--scroll">
      {subtitle && <p className="cc-tab-subtitle">{subtitle}</p>}

      <div className="cc-confidence cc-confidence--top">
        <div
          className="cc-confidence-bar"
          style={{
            width: `${Math.round(card.confidence * 100)}%`,
            background: confidenceColor(card.confidence),
          }}
        />
        <span
          className="cc-confidence-label"
          style={{ color: confidenceColor(card.confidence) }}
        >
          {Math.round(card.confidence * 100)}%
        </span>
      </div>

      <p className="cc-conclusion">{card.conclusion}</p>

      {card.supporting.length > 0 && (
        <div className="cc-evidence">
          <span className="cc-evidence-label">支持</span>
          <ul className="cc-evidence-list">
            {card.supporting.map((item, i) => (
              <li key={i} className="cc-evidence-item cc-evidence-item--supporting">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {card.counter.length > 0 && (
        <div className="cc-evidence">
          <span className="cc-evidence-label cc-evidence-label--counter">反方</span>
          <ul className="cc-evidence-list">
            {card.counter.map((item, i) => (
              <li key={i} className="cc-evidence-item cc-evidence-item--counter">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {mentions && mentions.mentions.length > 0 && (
        <div className="cc-mentions-inline">
          <span className="cc-evidence-label">大师原文</span>
          {mentions.mentions.map((m, i) => (
            <div key={i} className="cc-mention">
              <div className="cc-mention-meta">
                <span className="cc-mention-master">{m.master}</span>
                <span className="cc-mention-year">{m.year}</span>
              </div>
              <p className="cc-mention-excerpt">&ldquo;{m.excerpt}&rdquo;</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  shareholder: "股东信",
  partnership:  "合伙人信",
  post:         "问答 / 帖子",
  speech:       "演讲",
};

function EvidencePanel({
  decision,
  references,
  questions,
}: {
  decision: DecisionStatus;
  references?: CanvasReference[];
  questions: string[];
}) {
  return (
    <div className="cc-tab-body cc-tab-body--scroll cc-judgment-tab">
      {/* Compact decision status */}
      <div className="cc-evidence-status">
        <span className="cc-label">研判</span>
        <span className={`cc-decision-chip cc-decision-chip--${decision} cc-decision-chip--active`}>
          {DECISION_LABEL[decision]}
        </span>
      </div>

      {/* Reference links */}
      {references && references.length > 0 && (
        <div className="cc-evidence-refs">
          <span className="cc-label">参考来源</span>
          <div className="cc-ref-list">
            {references.map((ref, i) => (
              <div key={i} className="cc-ref-item">
                <div className="cc-ref-meta">
                  <span className="cc-ref-master">{ref.master}</span>
                  <span className="cc-ref-source">{SOURCE_LABEL[ref.sourceType] ?? ref.sourceType}</span>
                  <span className="cc-ref-year">{ref.year}</span>
                </div>
                {ref.excerpt && (
                  <p className="cc-ref-excerpt">&ldquo;{ref.excerpt}&rdquo;</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Open questions */}
      {questions.length > 0 && (
        <div className="cc-questions">
          <span className="cc-label">待验证</span>
          <ul className="cc-questions-list">
            {questions.map((q, i) => (
              <li key={i} className="cc-question-item">{q}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function CompanyCanvas({ state }: { state: CanvasState }) {
  const [activeTab, setActiveTab] = useState<TabKey>("company_overview");

  const overview = state.cards.find((c) => c.type === "company_overview") as
    | CompanyOverviewCard | undefined;

  const financialFacts = state.cards.find((c) => c.type === "financial_facts") as
    | FinancialFactsCard | undefined;

  const rightBusiness = state.cards.find((c) => c.type === "right_business") as
    | AnalysisCard | undefined;

  const rightPeople = state.cards.find((c) => c.type === "right_people") as
    | AnalysisCard | undefined;

  const rightPrice = state.cards.find((c) => c.type === "right_price") as
    | AnalysisCard | undefined;

  const mentions = state.cards.find((c) => c.type === "master_mentions") as
    | MasterMentionsCard | undefined;

  function cardStatus(key: TabKey): string {
    if (key === "judgment") return "done";
    const card = state.cards.find((c) => c.type === key);
    return card?.status ?? "pending";
  }

  return (
    <div className="company-canvas">
      {/* Tab bar */}
      <div className="cc-tabbar">
        {TABS.map((tab) => {
          const status = cardStatus(tab.key);
          return (
            <button
              key={tab.key}
              className={`cc-tab-btn${activeTab === tab.key ? " cc-tab-btn--active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
              {status === "streaming" && <span className="cc-tab-dot cc-tab-dot--stream" />}
              {status === "pending"   && <span className="cc-tab-dot cc-tab-dot--pending" />}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="cc-tab-content">
        {activeTab === "company_overview" && overview && (
          <OverviewTab card={overview} />
        )}
        {activeTab === "financial_facts" && financialFacts && (
          <FinancialTab card={financialFacts} />
        )}
        {activeTab === "right_business" && rightBusiness && (
          <AnalysisTab card={rightBusiness} mentions={mentions} />
        )}
        {activeTab === "right_people" && rightPeople && (
          <AnalysisTab card={rightPeople} />
        )}
        {activeTab === "right_price" && rightPrice && (
          <AnalysisTab card={rightPrice} />
        )}
        {activeTab === "judgment" && (
          <EvidencePanel
            decision={state.decision}
            references={state.references}
            questions={state.openQuestions}
          />
        )}
      </div>
    </div>
  );
}
