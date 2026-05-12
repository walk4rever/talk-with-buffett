import Link from "next/link";
import { notFound } from "next/navigation";
import { BtLogoMark } from "@/components/BtLogoMark";
import { getTribeMember } from "@/lib/tribe";
import {
  formatShares,
  formatValueUsd,
  getAvailableQuarters,
  getHoldingsByQuarter,
} from "@/lib/person-data";

function BtMark() {
  return <BtLogoMark />;
}

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string; quarter?: string }>;
}

function formatPriceFromValueAndShares(valueUsd: bigint | null, shares: bigint | null) {
  if (valueUsd == null || shares == null) return "—";
  const v = Number(valueUsd);
  const s = Number(shares);
  if (!Number.isFinite(v) || !Number.isFinite(s) || s <= 0) return "—";
  return `$${(v / s).toFixed(2)}`;
}

function formatSignedPct(diffPct: number | null) {
  if (diffPct == null || !Number.isFinite(diffPct)) return "—";
  const sign = diffPct > 0 ? "+" : "";
  return `${sign}${diffPct.toFixed(1)}%`;
}

function shortZhName(name: string, max = 8) {
  const cleaned = name.replace(/\s+/g, "");
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
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

  const holdings = await getHoldingsByQuarter(id, selectedYear, selectedQuarter);
  const selectedIndex = quarters.findIndex((q) => q.year === selectedYear && q.quarter === selectedQuarter);
  const prevQuarter = selectedIndex >= 0 ? quarters[selectedIndex + 1] : undefined;
  const prevHoldings = prevQuarter
    ? await getHoldingsByQuarter(id, prevQuarter.year, prevQuarter.quarter)
    : [];
  const prevBySecurityId = new Map(prevHoldings.map((h) => [h.securityEntityId, h] as const));

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
            <BtMark />
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

        {/* Quarter selector timeline */}
        <div className="holdings-timeline-wrap">
          <div className="holdings-timeline-line" />
          <div className="holdings-timeline">
            {quarters.map((q) => {
              const active = q.year === selectedYear && q.quarter === selectedQuarter;
              return (
                <Link
                  key={`${q.year}-${q.quarter}`}
                  href={`/person/${id}/holdings?year=${q.year}&quarter=${q.quarter}`}
                  className={`holdings-timeline-node${active ? " holdings-timeline-node--active" : ""}`}
                  style={active ? { borderColor: member.color, color: member.color } : undefined}
                >
                  <span className="holdings-timeline-dot" />
                  <span className="holdings-timeline-label">{q.year} Q{q.quarter}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Summary bar */}
        <div className="holdings-summary">
          <span className="holdings-summary-item">
            <em>{holdings.length}</em> 持仓
          </span>
          <span className="holdings-summary-sep">·</span>
          <span className="holdings-summary-item">
            总计 <em>{formatValueUsd(BigInt(Math.round(totalValue)))}</em>
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
                <th className="holdings-th">Stock</th>
                <th className="holdings-th holdings-th--num">% of Portfolio</th>
                <th className="holdings-th">Recent Activity</th>
                <th className="holdings-th holdings-th--num">Shares</th>
                <th className="holdings-th holdings-th--num">Reported Price*</th>
                <th className="holdings-th holdings-th--num">Value</th>
                <th className="holdings-th holdings-th--num">Current Price</th>
                <th className="holdings-th holdings-th--num">+/- Reported Price</th>
                <th className="holdings-th holdings-th--num">52 Week Low</th>
                <th className="holdings-th holdings-th--num">52 Week High</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h, i) => {
                const prev = prevBySecurityId.get(h.securityEntityId);
                const prevShares = prev?.shares ? Number(prev.shares) : null;
                const nowShares = h.shares ? Number(h.shares) : null;
                const shareDeltaPct =
                  prevShares && nowShares && prevShares > 0
                    ? ((nowShares - prevShares) / prevShares) * 100
                    : null;
                const activity = !prev
                  ? "New"
                  : shareDeltaPct == null || Math.abs(shareDeltaPct) < 1
                    ? "Unchanged"
                    : shareDeltaPct > 0
                      ? "Added"
                      : "Reduced";
                const rowClass =
                  activity === "New"
                    ? "holdings-row holdings-row--new"
                    : activity === "Added"
                      ? "holdings-row holdings-row--added"
                      : activity === "Reduced"
                        ? "holdings-row holdings-row--reduced"
                        : "holdings-row";

                const reportedPrice = formatPriceFromValueAndShares(h.valueUsd, h.shares);
                const currentPrice = "—";
                const pctVsReported = "—";
                const low52 = "—";
                const high52 = "—";
                const ticker = h.security.ticker ?? "—";
                const stockLabel = `${shortZhName(h.security.canonicalName)} ${ticker}`;

                return (
                  <tr key={h.id} className={rowClass}>
                    <td className="holdings-td holdings-td--rank">{i + 1}</td>
                    <td className="holdings-td holdings-td--name">
                      <span className="holdings-company">
                        {h.security.ticker ? (
                          <Link href={`/company/${h.security.ticker}`}>{stockLabel}</Link>
                        ) : (
                          stockLabel
                        )}
                      </span>
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
                    <td className="holdings-td">
                      {activity === "New" ? (
                        <span className="holdings-activity-new" aria-label="new position">*</span>
                      ) : activity === "Added" ? (
                        <span className="holdings-activity-delta holdings-activity-delta--up">
                          ↑ {shareDeltaPct != null ? formatSignedPct(shareDeltaPct) : "—"}
                        </span>
                      ) : activity === "Reduced" ? (
                        <span className="holdings-activity-delta holdings-activity-delta--down">
                          ↓ {shareDeltaPct != null ? formatSignedPct(shareDeltaPct) : "—"}
                        </span>
                      ) : (
                        <span className="holdings-activity-delta">—</span>
                      )}
                    </td>
                    <td className="holdings-td holdings-td--num">{formatShares(h.shares)}</td>
                    <td className="holdings-td holdings-td--num">{reportedPrice}</td>
                    <td className="holdings-td holdings-td--num">{formatValueUsd(h.valueUsd)}</td>
                    <td className="holdings-td holdings-td--num">{currentPrice}</td>
                    <td className="holdings-td holdings-td--num">{pctVsReported}</td>
                    <td className="holdings-td holdings-td--num">{low52}</td>
                    <td className="holdings-td holdings-td--num">{high52}</td>
                  </tr>
                );
              })}
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
