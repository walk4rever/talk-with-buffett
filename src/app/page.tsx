import Link from "next/link";
import { BtLogoMark } from "@/components/BtLogoMark";
import { HeroSearch } from "@/components/HeroSearch";
import { TRIBE_MEMBERS } from "@/lib/tribe";

export const dynamic = "force-dynamic";

const SIGNALS = [
  {
    type: "consensus" as const,
    tag: "★ 共识持仓",
    ticker: "BAC",
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
    company: "Apple",
    body: "巴菲特连续4季减持至5.2亿股；段永平仍视为核心持仓",
    chips: [
      { label: "Buffett ↓减持", style: { background: "#fef2f2", color: "#c53030" } },
      { label: "段永平 持有", style: { background: "#f0fdf4", color: "#2f855a" } },
    ],
  },
];

export default function Home() {
  return (
    <div className="home-v2">
      {/* Nav */}
      <nav className="home-nav">
        <div className="home-nav-in">
          <Link href="/" className="home-nav-logo">
            <BtLogoMark />
            Buffett Tribe
          </Link>
          <div className="home-nav-right">
            <Link href="/login" className="home-nav-login">登录</Link>
          </div>
        </div>
      </nav>

      {/* Signals */}
      <section className="home-signals">
        <div className="home-signals-in">
          {SIGNALS.map((s) => (
            <div key={s.ticker} className={`home-sig home-sig--${s.type}`}>
              <span className="home-sig-tag">{s.tag}</span>
              <Link href={`/company/${s.ticker}`} className="home-sig-ticker">
                {s.ticker}
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
        <p className="home-hero-eyebrow">伟大投资人的思想档案</p>
        <h1 className="home-hero-brand">
          他们说了什么<br /><em>他们怎么做的</em>
        </h1>
        <p className="home-hero-sub">追踪 Warren Buffett、李录、段永平的信件、演讲与持仓<br />与他们的思想直接对话</p>
        <HeroSearch />
      </section>

      {/* Members */}
      <section className="home-members">
        <div className="home-members-in">
          <p className="home-members-hd">部落成员</p>
          <div className="home-member-list">
            {TRIBE_MEMBERS.map((m) => (
              <Link key={m.id} href={`/person/${m.id}`} className="home-member-card">
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
                  {m.aum && <span className="home-member-aum">{m.aum}</span>}
                </div>
                <div className="home-member-links">
                  <div className="home-member-link">
                    <span className="home-member-link-icon">
                      {m.id === "duan" ? "✍️" : m.id === "lilu" ? "🎙" : "📝"}
                    </span>
                    <span className="home-member-link-text">
                      {m.materialLabel}
                      <em>{m.materialSub}</em>
                    </span>
                  </div>
                  <div className="home-member-link">
                    <span className="home-member-link-icon">📊</span>
                    <span className="home-member-link-text">
                      持仓快照
                      <em>2025 Q4</em>
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <footer className="home-footer-v2">
        <div className="home-footer-v2-in">
          <span className="home-footer-logo">
            <BtLogoMark />
            Buffett Tribe
          </span>
          <p className="home-footer-note">
            数据来源：SEC EDGAR 13F-HR · 本站为研究工具，不构成投资建议
          </p>
        </div>
      </footer>
    </div>
  );
}
