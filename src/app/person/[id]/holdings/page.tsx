import Link from "next/link";
import { notFound } from "next/navigation";
import db from "@/lib/prisma";
import { getTribeMember } from "@/lib/tribe";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string; quarter?: string }>;
}

async function getAvailableQuarters(tribeId: string) {
  const sources = await db.extSource.findMany({
    where: { filer: { is: { tribeId } }, kind: "13f" },
    select: { periodYear: true, periodQuarter: true },
    orderBy: [{ periodYear: "desc" }, { periodQuarter: "desc" }],
  });
  return sources
    .filter((s) => s.periodYear != null && s.periodQuarter != null)
    .map((s) => ({ year: s.periodYear!, quarter: s.periodQuarter! }));
}

async function getHoldings(tribeId: string, year: number, quarter: number) {
  return db.holding.findMany({
    where: {
      holder: { tribeId },
      source: { is: { periodYear: year, periodQuarter: quarter, kind: "13f" } },
    },
    include: { security: true },
    orderBy: { percentOfPortfolio: "desc" },
  });
}

function fmtValue(valueUsd: bigint | null): string {
  if (valueUsd == null) return "—";
  const usd = Number(valueUsd);
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
  return `$${usd.toLocaleString()}`;
}

function fmtShares(shares: bigint | null): string {
  if (shares == null) return "—";
  const n = Number(shares);
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toLocaleString();
}

export default async function HoldingsPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { year: yearStr, quarter: quarterStr } = await searchParams;

  const member = getTribeMember(id);
  if (!member) notFound();

  const quarters = await getAvailableQuarters(id);
  if (quarters.length === 0) notFound();

  const selectedYear = yearStr ? parseInt(yearStr) : quarters[0].year;
  const selectedQuarter = quarterStr ? parseInt(quarterStr) : quarters[0].quarter;

  const holdings = await getHoldings(id, selectedYear, selectedQuarter);

  const totalValue = holdings.reduce(
    (sum, h) => sum + (h.valueUsd ? Number(h.valueUsd) : 0),
    0,
  );

  return (
    <div className="holdings-page">
      {/* Nav */}
      <nav className="home-nav">
        <div className="home-nav-in">
          <Link href="/" className="home-nav-logo">
            <div className="home-nav-logo-mark">BT</div>
            Buffett Tribe
          </Link>
          <div className="home-nav-right">
            <Link href="/" className="home-nav-link">首页</Link>
            <Link href={`/text/room?person=${id}`} className="home-nav-login">对话</Link>
          </div>
        </div>
      </nav>

      <div className="holdings-wrap">
        {/* Person header */}
        <div className="holdings-hd">
          <span className="holdings-avatar" style={{ background: member.color }}>
            {member.initials.slice(0, 2)}
          </span>
          <div className="holdings-hd-info">
            <p className="holdings-eyebrow">持仓快照</p>
            <h1 className="holdings-name">{member.nameZh}</h1>
            <p className="holdings-firm">{member.firm}</p>
            {member.aum && <span className="holdings-aum">{member.aum} AUM</span>}
          </div>
        </div>

        {/* Quarter selector */}
        <div className="holdings-quarters">
          {quarters.map((q) => {
            const active = q.year === selectedYear && q.quarter === selectedQuarter;
            return (
              <Link
                key={`${q.year}-${q.quarter}`}
                href={`/person/${id}/holdings?year=${q.year}&quarter=${q.quarter}`}
                className={`holdings-q${active ? " holdings-q--active" : ""}`}
                style={active ? { borderColor: member.color, color: member.color } : undefined}
              >
                {q.year} Q{q.quarter}
              </Link>
            );
          })}
        </div>

        {/* Summary bar */}
        <div className="holdings-summary">
          <span className="holdings-summary-item">
            <em>{holdings.length}</em> 持仓
          </span>
          <span className="holdings-summary-sep">·</span>
          <span className="holdings-summary-item">
            总计 <em>{fmtValue(BigInt(Math.round(totalValue)))}</em>
          </span>
          <span className="holdings-summary-sep">·</span>
          <span className="holdings-summary-item">
            {selectedYear} Q{selectedQuarter} · 数据来源 SEC 13F
          </span>
        </div>

        {/* Holdings table */}
        <div className="holdings-table-wrap">
          <table className="holdings-table">
            <thead>
              <tr>
                <th className="holdings-th holdings-th--rank">#</th>
                <th className="holdings-th">公司</th>
                <th className="holdings-th holdings-th--num">占比</th>
                <th className="holdings-th holdings-th--num">市值</th>
                <th className="holdings-th holdings-th--num">股数</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h, i) => (
                <tr key={h.id} className="holdings-row">
                  <td className="holdings-td holdings-td--rank">{i + 1}</td>
                  <td className="holdings-td holdings-td--name">
                    <span className="holdings-company">{h.security.canonicalName}</span>
                    {h.security.ticker && (
                      <span className="holdings-ticker">{h.security.ticker}</span>
                    )}
                  </td>
                  <td className="holdings-td holdings-td--num">
                    <div className="holdings-pct-wrap">
                      <span className="holdings-pct">
                        {h.percentOfPortfolio != null
                          ? `${h.percentOfPortfolio.toFixed(2)}%`
                          : "—"}
                      </span>
                      <div
                        className="holdings-bar"
                        style={{
                          width: `${Math.min(h.percentOfPortfolio ?? 0, 100)}%`,
                          background: member.color,
                        }}
                      />
                    </div>
                  </td>
                  <td className="holdings-td holdings-td--num">{fmtValue(h.valueUsd)}</td>
                  <td className="holdings-td holdings-td--num">{fmtShares(h.shares)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="holdings-note">
          数据来源：SEC EDGAR 13F-HR · 数值为申报日市值，不构成投资建议
        </p>
      </div>
    </div>
  );
}
