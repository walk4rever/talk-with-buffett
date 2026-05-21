import Link from "next/link";
import { formatCompanyPathFromCik } from "@/lib/cik";
import { SiteNav } from "@/components/SiteNav";
import { HeroSearch } from "@/components/HeroSearch";
import { formatAumForHome, TRIBE_MEMBERS } from "@/lib/tribe";
import { getAvailableQuarters, getMasterClassSummary } from "@/lib/master-data";

export const dynamic = "force-dynamic";

const SIGNALS = [
  {
    type: "consensus" as const,
    tag: "★ 共识持仓",
    ticker: "BAC",
    cik: "70858",
    tickerLabel: "美国银行（BAC）",
    company: "Bank of America",
    body: "巴菲特持有14年，李录独立建仓，均列前3重仓",
    chips: [
      { label: "Buffett 10.4%", style: { background: "#fdf2f2", color: "#8b0000" } },
      { label: "李录 16.1%", style: { background: "#eff6ff", color: "#1d4ed8" } },
    ],
  },
  {
    type: "new" as const,
    tag: "↑ 新动作",
    ticker: "OXY",
    cik: "797468",
    tickerLabel: "西方石油（OXY）",
    company: "Occidental Petroleum",
    body: "巴菲特本季继续增持，持仓占比突破28%，接近收购门槛",
    chips: [
      { label: "Buffett 28.2% ↑", style: { background: "#fdf2f2", color: "#8b0000" } },
    ],
  },
  {
    type: "divergent" as const,
    tag: "⇅ 各有判断",
    ticker: "AAPL",
    cik: "320193",
    tickerLabel: "苹果（AAPL）",
    company: "Apple",
    body: "巴菲特连续4季减持至5.2亿股；段永平仍视为核心持仓",
    chips: [
      { label: "Buffett ↓减持", style: { background: "#fef2f2", color: "#c53030" } },
      { label: "段永平 持有", style: { background: "#f0fdf4", color: "#2f855a" } },
    ],
  },
];

export default async function Home() {
  const memberStates = await Promise.all(
    TRIBE_MEMBERS.map(async (m) => {
      const [quarters, classes] = await Promise.all([
        getAvailableQuarters(m.id),
        getMasterClassSummary(m.id),
      ]);
      return {
        id: m.id,
        latestQuarter: quarters[0] ?? null,
        hasLibrary: classes.some((c) => c.count > 0),
      };
    })
  );

  const stateMap = new Map(memberStates.map((s) => [s.id, s]));

  return (
    <div className="home-v2">
      <SiteNav />

      {/* Signals */}
      <section className="home-signals">
        <div className="home-signals-in">
          {SIGNALS.map((s) => (
            <div key={s.ticker} className={`home-sig home-sig--${s.type}`}>
              <span className="home-sig-tag">{s.tag}</span>
              <Link href={formatCompanyPathFromCik(s.cik) ?? "#"} className="home-sig-ticker">
                {s.tickerLabel}
              </Link>
              <div className="home-sig-company">{s.company}</div>
              <div className="home-sig-body">{s.body}</div>
              <div className="home-sig-chips">
                {s.chips.map((c) => (
                  <span key={c.label} className="home-sig-chip" style={c.style}>
                    {c.label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Hero search */}
      <section className="home-hero">
        <Link href="/idea" className="home-hero-hitbox" aria-label="进入对话研究室" />
        <h1 className="home-hero-brand">买股票就是买公司</h1>
        <p className="home-hero-sub home-hero-sub--compact">
          用大师的框架，看懂一家公司
        </p>
        <HeroSearch />
      </section>

      {/* Members */}
      <section className="home-members">
        <div className="home-members-in">
          <p className="home-members-hd">部落成员</p>
          <div className="home-member-list">
            {TRIBE_MEMBERS.map((m) => {
              const state = stateMap.get(m.id)!;
              return (
                <div key={m.id} className="home-member-card">
                  <Link href={`/master/${m.id}`} className="home-member-main">
                    <div className="home-member-top">
                      <span
                        className="home-member-avatar"
                        style={{ background: m.color }}
                      >
                        {m.initials.slice(0, 2)}
                      </span>
                      <div className="home-member-info">
                        <div className="home-member-name">{m.nameZh}</div>
                        <div className="home-member-firm">{m.firm}</div>
                      </div>
                      {m.aum && <span className="home-member-aum">{formatAumForHome(m.aum) ?? m.aum}</span>}
                    </div>
                  </Link>
                  <div className="home-member-links">
                    {state.hasLibrary ? (
                      <Link href={m.materialHref} className="home-member-link">
                        <span className="home-member-link-icon">{m.icon}</span>
                        <span className="home-member-link-text">
                          {m.materialLabel}
                          <em>{m.materialSub}</em>
                        </span>
                      </Link>
                    ) : (
                      <span className="home-member-link home-member-link--disabled" title="即将上线">
                        <span className="home-member-link-icon">{m.icon}</span>
                        <span className="home-member-link-text">
                          {m.materialLabel}
                          <em>即将上线</em>
                        </span>
                      </span>
                    )}
                    {state.latestQuarter ? (
                      <Link href={m.holdingsHref} className="home-member-link">
                        <span className="home-member-link-icon">📊</span>
                        <span className="home-member-link-text">
                          最新持仓
                          <em>{state.latestQuarter.year} Q{state.latestQuarter.quarter}</em>
                        </span>
                      </Link>
                    ) : (
                      <span className="home-member-link home-member-link--disabled">
                        <span className="home-member-link-icon">📊</span>
                        <span className="home-member-link-text">
                          最新持仓
                          <em>暂无数据</em>
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

    </div>
  );
}
