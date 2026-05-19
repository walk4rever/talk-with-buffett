import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyDisplayName } from "@/components/CompanyDisplayName";
import { SiteNav } from "@/components/SiteNav";
import { getTribeMember } from "@/lib/tribe";
import {
  buildHoldingInsights,
  formatShares,
  formatValueUsd,
  getHoldingsByQuarter,
  getLatestHoldingChangeSet,
  getMasterClassSummary,
} from "@/lib/master-data";

export const revalidate = 300; // cache 5 min — holdings/letters update infrequently


interface Props {
  params: Promise<{ id: string }>;
}

const PIE_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#84cc16",
  "#ec4899",
  "#64748b",
];

type PieDatum = {
  zh: string;
  en: string;
  code: string;
  pct: number;
  color: string;
};

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

function buildPieSeries(
  changeSet: Awaited<ReturnType<typeof getLatestHoldingChangeSet>>,
) {
  const merged = new Map<string, PieDatum>();
  let colorIdx = 0;
  for (const h of changeSet.top) {
    const d = getHoldingDisplay(h.security);
    const key = `${d.zh}__${d.code}`;
    const pct = Math.max(0, h.percentOfPortfolio ?? 0);
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, { ...existing, pct: existing.pct + pct });
    } else {
      merged.set(key, { zh: d.zh, en: d.en, code: d.code, pct, color: PIE_COLORS[colorIdx++ % PIE_COLORS.length] });
    }
  }
  const top = Array.from(merged.values());
  const topPct = top.reduce((sum, x) => sum + x.pct, 0);
  const otherPct = Math.max(0, 100 - topPct);
  return [...top, { zh: "其他", en: "Others", code: "—", pct: otherPct, color: "#e5e7eb" }] as PieDatum[];
}

function getHoldingDisplay(security: {
  ticker: string | null;
  canonicalName: string;
  metadata: unknown;
}) {
  const meta = (security.metadata ?? {}) as { cusip?: string; nameZh?: string; nameEnShort?: string };
  const code = security.ticker ?? meta.cusip ?? "—";
  const en = meta.nameEnShort ?? security.canonicalName;
  const zh = meta.nameZh ?? en;
  return { code, zh, en };
}

const INVESTOR_BRIEF: Record<
  string,
  { intro: string; framework: string[]; tags: string[]; timeline: string[] }
> = {
  buffett: {
    intro:
      "Warren Buffett 是 Berkshire Hathaway 董事长，以长期价值投资和纪律化资本配置闻名。",
    framework: [
      "能力圈：只做可理解且可长期跟踪的业务",
      "护城河：品牌、成本优势、网络效应与定价权",
      "管理层：资本配置纪律与股东导向",
      "估值纪律：价格低于内在价值时出手",
    ],
    tags: ["长期主义", "高ROE", "现金流确定性", "逆向决策"],
    timeline: [
      "1956：成立 Buffett Partnership",
      "1965：控制 Berkshire Hathaway",
      "1970 起：连续发布致股东信",
      "当前：管理大型公开股票组合与全资业务",
    ],
  },
  lilu: {
    intro: "李录，喜马拉雅资本创始人，长期专注价值投资与能力圈。",
    framework: [
      "能力圈和安全边际并重",
      "少而精，长期跟踪高质量公司",
      "重视企业文化与治理质量",
    ],
    tags: ["集中持仓", "长期复利", "基本面驱动"],
    timeline: ["资料建设中"],
  },
  duan: {
    intro: "段永平，H&H International Investment，长期投资实践者。",
    framework: [
      "商业模式优先，追求简单可验证",
      "管理层与企业文化是核心筛选",
      "以长期回报而非短期波动为导向",
    ],
    tags: ["商业模式", "管理层质量", "长期主义"],
    timeline: ["资料建设中"],
  },
};

export default async function PersonHubPage({ params }: Props) {
  const { id } = await params;
  const member = getTribeMember(id);
  if (!member) notFound();

  const [masterClass, changeSet] = await Promise.all([
    getMasterClassSummary(id),
    getLatestHoldingChangeSet(id),
  ]);

  const brief = INVESTOR_BRIEF[id] ?? INVESTOR_BRIEF.buffett;
  const insights = buildHoldingInsights(changeSet);
  const latest = changeSet.latest;
  const latestLabel = latest ? `${latest.year} Q${latest.quarter}` : "暂无数据";
  const baseLabel = changeSet.base ? `${changeSet.base.year} Q${changeSet.base.quarter}` : "无可比季度";
  const pieData = buildPieSeries(changeSet);
  const fullHoldings = latest
    ? await getHoldingsByQuarter(id, latest.year, latest.quarter)
    : [];
  const prevHoldings = changeSet.base
    ? await getHoldingsByQuarter(id, changeSet.base.year, changeSet.base.quarter)
    : [];
  const holdingKey = (h: (typeof prevHoldings)[number]) => h.securityId ?? h.securityEntityId;
  const prevBySecurityId = new Map(prevHoldings.map((h) => [holdingKey(h), h] as const));

  return (
    <div className="person-page">
      <SiteNav />

      <div className="person-wrap">
        <section className="person-hero">
          <div className="person-hero-accent" style={{ background: member.color }} />
          <div className="person-hero-body">
            <span className="person-avatar" style={{ background: member.color }}>
              {member.initials.slice(0, 2)}
            </span>
            <div className="person-hero-info">
              <p className="person-eyebrow">Investor Profile</p>
              <h1 className="person-name">{member.nameZh}</h1>
              <p className="person-firm">{member.firm}</p>
              <p className="person-intro">{brief.intro}</p>
              <div className="person-framework">
                {brief.framework.map((line) => (
                  <div key={line} className="person-framework-item">{line}</div>
                ))}
              </div>
              <div className="person-tags">
                {brief.tags.map((tag) => (
                  <span key={tag} className="person-tag">{tag}</span>
                ))}
              </div>
              <div className="person-timeline">
                {brief.timeline.map((line) => (
                  <span key={line} className="person-timeline-item">{line}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="person-section">
          <div className="person-section-head">
            <h2 className="person-section-title">资料库</h2>
          </div>
          <div className="person-master-grid">
            {masterClass.filter((item) => item.count > 0).map((item) => (
              <Link
                key={item.key}
                href={
                  item.latest
                    ? `/master/${id}/library?type=${encodeURIComponent(item.key)}&year=${item.latest}`
                    : item.href
                }
                className="person-master-card"
              >
                <div className="person-master-title">{item.label}</div>
                <div className="person-master-meta">
                  <span>{item.count} 篇</span>
                  <span>{item.range}</span>
                </div>
                <div className="person-master-latest">
                  最近：{item.latest ?? "—"}
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="person-section">
          <div className="person-section-head">
            <div>
              <h2 className="person-section-title">最新持仓（{latestLabel}）</h2>
              <p className="person-compare-note">对比基准：{baseLabel}</p>
            </div>
            {latest ? (
              <Link href={`/master/${id}/holdings`} className="person-view-all">
                持仓历史
              </Link>
            ) : null}
          </div>
          {latest && changeSet.top.length ? (
            <>
              <div className="person-top-grid">
                <div className="person-top10">
                  <div className="person-pie-svg-wrap">
                    <div className="person-bar-chart" role="img" aria-label="Top10 持仓占比横向柱状图">
                      {pieData.filter((s) => s.pct > 0).map((seg, idx) => (
                        <div key={`${seg.zh}-${seg.code}-${idx}`} className="person-bar-row">
                          <div className="person-bar-head">
                            <span className="person-bar-name">
                              <CompanyDisplayName
                                zhName={seg.zh}
                                enName={seg.en}
                                ticker={seg.code === "—" ? null : seg.code}
                                compact
                              />
                            </span>
                            <span className="person-bar-pct">{seg.pct.toFixed(1)}%</span>
                          </div>
                          <div className="person-bar-track">
                            <div
                              className="person-bar-fill"
                              style={{
                                width: `${Math.max(2, Math.min(100, seg.pct))}%`,
                                background: seg.color,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="person-insights">
                  <h3>持仓洞察</h3>
                  {insights.length ? insights.map((x) => (
                    <div key={x} className="person-insight-row">{x}</div>
                  )) : <p className="person-empty">暂无洞察。</p>}
                </div>
              </div>

              <div className="person-holdings-full">
                <div className="person-section-head">
                  <h2 className="person-section-title">持仓明细（{latestLabel}）</h2>
                </div>
                <div className="holdings-table-wrap person-holdings-table-wrap">
                  <table className="holdings-table person-holdings-table">
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
                      {fullHoldings.map((h, i) => {
                        const display = getHoldingDisplay(h.security);
                        const prev = prevBySecurityId.get(holdingKey(h));
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
                        return (
                          <tr key={h.id} className={rowClass}>
                            <td className="holdings-td holdings-td--rank">{i + 1}</td>
                            <td className="holdings-td holdings-td--name">
                              <span className="holdings-company">
                                {h.security.ticker ? (
                                  <Link href={`/company/${h.security.ticker}`}>
                                    <CompanyDisplayName
                                      zhName={display.zh}
                                      enName={display.en}
                                      ticker={h.security.ticker}
                                      compact
                                    />
                                  </Link>
                                ) : (
                                  <CompanyDisplayName
                                    zhName={display.zh}
                                    enName={display.en}
                                    ticker={h.security.ticker}
                                    compact
                                  />
                                )}
                              </span>
                            </td>
                            <td className="holdings-td holdings-td--num">
                              {h.percentOfPortfolio != null ? `${h.percentOfPortfolio.toFixed(2)}%` : "—"}
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
                            <td className="holdings-td holdings-td--num">{formatPriceFromValueAndShares(h.valueUsd, h.shares)}</td>
                            <td className="holdings-td holdings-td--num">{formatValueUsd(h.valueUsd)}</td>
                            <td className="holdings-td holdings-td--num">—</td>
                            <td className="holdings-td holdings-td--num">—</td>
                            <td className="holdings-td holdings-td--num">—</td>
                            <td className="holdings-td holdings-td--num">—</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <p className="person-empty">暂无持仓数据。</p>
          )}
        </section>
      </div>
    </div>
  );
}
