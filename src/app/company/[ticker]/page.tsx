import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyDisplayName } from "@/components/CompanyDisplayName";
import { SiteNav } from "@/components/SiteNav";
import {
  formatMoney,
  getCompanyByCik,
  getCompanyFinancials,
  getRecentHolders,
} from "@/lib/company-data";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ ticker: string }>;
}

type YearItems = { year: number; items: Record<string, string> };

const LINE_ITEMS = [
  { key: "Revenue", label: "Revenue" },
  { key: "GrossProfit", label: "Gross Profit" },
  { key: "OperatingIncome", label: "Operating Income" },
  { key: "NetIncome", label: "Net Income" },
  { key: "OperatingCashFlow", label: "Operating Cash Flow" },
  { key: "TotalAssets", label: "Total Assets" },
  { key: "TotalLiabilities", label: "Total Liabilities" },
  { key: "ShareholdersEquity", label: "Shareholders' Equity" },
  { key: "EPSBasic", label: "EPS Basic" },
  { key: "EPSDiluted", label: "EPS Diluted" },
];

function num(items: Record<string, string>, key: string) {
  const raw = items[key];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function ratio(numerator: number | null, denominator: number | null) {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

function pct(v: number | null, digits = 1) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function cagr(end: number | null, start: number | null, years: number) {
  if (end == null || start == null || start <= 0 || years <= 0) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

function getValue(financials: YearItems[], year: number, key: string) {
  const row = financials.find((f) => f.year === year);
  if (!row) return null;
  return num(row.items, key);
}

function normalizeMeta(metadata: unknown): Record<string, string | number | boolean | null> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return metadata as Record<string, string | number | boolean | null>;
}

export default async function CompanyPage({ params }: Props) {
  const { ticker: rawTicker } = await params;
  const requestId = rawTicker.trim();
  const company = await getCompanyByCik(requestId);
  if (!company) notFound();
  const displayTicker = company.ticker ?? "—";

  const [financials, holders] = await Promise.all([
    getCompanyFinancials(company.id, 8),
    getRecentHolders(company.id, 30),
  ]);

  const latest = financials[0];
  const fiveYearsAgo = financials[4];

  const rev = latest ? num(latest.items, "Revenue") : null;
  const gross = latest ? num(latest.items, "GrossProfit") : null;
  const net = latest ? num(latest.items, "NetIncome") : null;
  const equity = latest ? num(latest.items, "ShareholdersEquity") : null;
  const liabilities = latest ? num(latest.items, "TotalLiabilities") : null;
  const assets = latest ? num(latest.items, "TotalAssets") : null;

  const rev5y = latest && fiveYearsAgo ? cagr(rev, num(fiveYearsAgo.items, "Revenue"), 4) : null;

  const grossMargin = ratio(gross, rev);
  const netMargin = ratio(net, rev);
  const roe = ratio(net, equity);
  const debtToAssets = ratio(liabilities, assets);

  const meta = normalizeMeta(company.metadata);
  const zhName =
    (typeof meta.nameZh === "string" && meta.nameZh.trim()) ? meta.nameZh.trim() : company.canonicalName;
  const enDisplayName =
    (typeof meta.nameEnShort === "string" && meta.nameEnShort.trim())
      ? meta.nameEnShort.trim()
      : company.canonicalName;
  const latestYear = latest?.year ?? null;
  const priorYear = latestYear ? latestYear - 1 : null;
  const revYoY =
    latestYear && priorYear
      ? ratio(rev, getValue(financials, priorYear, "Revenue"))
      : null;

  const cards = [
    { label: "Revenue", value: formatMoney(rev == null ? null : String(rev)), hint: latestYear ? `FY ${latestYear}` : "" },
    { label: "Gross Margin", value: pct(grossMargin), hint: "Gross Profit / Revenue" },
    { label: "Net Margin", value: pct(netMargin), hint: "Net Income / Revenue" },
    { label: "ROE", value: pct(roe), hint: "Net Income / Equity" },
    { label: "Debt / Assets", value: pct(debtToAssets), hint: "Liabilities / Assets" },
    { label: "Revenue CAGR (5Y)", value: pct(rev5y), hint: "From latest 5 fiscal years" },
    {
      label: "Revenue YoY",
      value:
        revYoY == null || !Number.isFinite(revYoY)
          ? "—"
          : `${(((revYoY - 1) * 100)).toFixed(1)}%`,
      hint: priorYear ? `${latestYear} vs ${priorYear}` : "",
    },
    { label: "EPS Diluted", value: latest?.items.EPSDiluted ?? "—", hint: latestYear ? `FY ${latestYear}` : "" },
  ];

  return (
    <div className="company-page">
      <SiteNav />

      <div className="company-wrap">
        <section className="company-hero">
          <p className="company-eyebrow">EDGAR Company Profile</p>
          <h1 className="company-name">
            <CompanyDisplayName
              zhName={zhName}
              enName={enDisplayName}
              ticker={displayTicker}
              className="company-display--hero"
            />
          </h1>
          <div className="company-meta">
            <span className="company-chip">{displayTicker}</span>
            {company.cik ? <span className="company-chip">CIK {company.cik}</span> : null}
            {company.sector ? <span className="company-chip">{company.sector}</span> : null}
            {meta.exchange ? <span className="company-chip">{String(meta.exchange)}</span> : null}
            {meta.industry ? <span className="company-chip">{String(meta.industry)}</span> : null}
          </div>
        </section>

        <section className="company-section">
          <div className="company-section-head">
            <h2>价值投资看板</h2>
            <span>{latestYear ? `Based on FY ${latestYear} 10-K` : "暂无可计算数据"}</span>
          </div>
          <div className="company-kpi-grid">
            {cards.map((card) => (
              <article className="company-kpi-card" key={card.label}>
                <p>{card.label}</p>
                <strong>{card.value}</strong>
                <span>{card.hint || " "}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="company-section company-split">
          <div>
            <div className="company-section-head">
              <h2>公司基本信息</h2>
              <span>可由 EDGAR 与主数据维护</span>
            </div>
            <dl className="company-facts">
              <div><dt>Legal Name</dt><dd>{company.canonicalName}</dd></div>
              <div><dt>Ticker</dt><dd>{displayTicker}</dd></div>
              <div><dt>Requested Id</dt><dd>{requestId}</dd></div>
              <div><dt>CIK</dt><dd>{company.cik ?? "—"}</dd></div>
              <div><dt>Sector</dt><dd>{company.sector ?? "—"}</dd></div>
              <div><dt>Industry</dt><dd>{meta.industry ? String(meta.industry) : "—"}</dd></div>
              <div><dt>Exchange</dt><dd>{meta.exchange ? String(meta.exchange) : "—"}</dd></div>
              <div><dt>Latest 10-K Year</dt><dd>{latestYear ?? "—"}</dd></div>
              <div><dt>Latest 13F Holdings Date</dt><dd>{holders.asOfDate ? holders.asOfDate.toISOString().slice(0, 10) : "—"}</dd></div>
            </dl>
          </div>
          <div>
            <div className="company-section-head">
              <h2>研究焦点</h2>
              <span>供价值投资用户快速判断</span>
            </div>
            <ul className="company-focus-list">
              <li>盈利质量: 毛利率/净利率是否稳定，是否随周期大幅波动。</li>
              <li>资本效率: ROE 是否长期高于资本成本。</li>
              <li>财务安全边际: 负债占资产比例与现金流覆盖能力。</li>
              <li>增长质量: 5年营收 CAGR 与当年同比是否一致。</li>
              <li>机构共识: 前十大持仓机构集中度与持续持有情况。</li>
            </ul>
          </div>
        </section>

        <section className="company-section">
          <div className="company-section-head">
            <h2>年报关键指标（10-K）</h2>
            <span>{financials.length ? `最近 ${financials.length} 年` : "暂无数据"}</span>
          </div>
          {financials.length ? (
            <div className="company-table-wrap">
              <table className="company-table">
                <thead>
                  <tr>
                    <th>Line Item</th>
                    {financials.map((y) => (
                      <th key={y.year}>{y.year}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {LINE_ITEMS.map((line) => (
                    <tr key={line.key}>
                      <td>{line.label}</td>
                      {financials.map((y) => (
                        <td key={`${line.key}-${y.year}`}>
                          {line.key.startsWith("EPS")
                            ? (y.items[line.key] ?? "—")
                            : formatMoney(y.items[line.key] ?? null)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="company-empty">暂无 10-K 年报结构化数据。可先运行 `import:10k` 脚本。</p>
          )}
        </section>

        <section className="company-section">
          <div className="company-section-head">
            <h2>投资人最近持仓（13F）</h2>
            <span>
              {holders.asOfDate
                ? `as of ${holders.asOfDate.toISOString().slice(0, 10)}`
                : "暂无数据"}
            </span>
          </div>
          {holders.holders.length ? (
            <div className="company-holders">
              <div className="company-holder-row company-holder-head">
                <span>Holder</span>
                <span>Weight</span>
                <span>Value</span>
                <span>Report</span>
              </div>
              {holders.holders.map((h) => (
                <div key={h.id} className="company-holder-row">
                  <div>
                    <strong>{h.name}</strong>
                    {h.tribeId ? (
                      <Link href={`/master/${h.tribeId}`} className="company-holder-link">
                        {h.tribeId}
                      </Link>
                    ) : null}
                  </div>
                  <span>{h.percent != null ? `${h.percent.toFixed(2)}%` : "—"}</span>
                  <span>{formatMoney(h.valueUsd)}</span>
                  <span>{h.sourceYear && h.sourceQuarter ? `${h.sourceYear} Q${h.sourceQuarter}` : "—"}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="company-empty">暂无该公司的持仓记录。</p>
          )}
        </section>
      </div>
    </div>
  );
}
