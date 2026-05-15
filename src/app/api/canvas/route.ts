import { NextResponse } from "next/server";
import { getCompanyByTicker, getCompanyFinancials } from "@/lib/company-data";
import { VALUE_FRAMEWORK_LENSES } from "@/lib/canvas-mock";
import type {
  CanvasState,
  FinancialMetric,
  TrendPoint,
} from "@/types/canvas";

export const maxDuration = 30;

const LINE_ITEM_CFG: Record<string, { label: string; format: "money" | "pct" | "raw" }> = {
  revenue:          { label: "营收",      format: "money" },
  net_income:       { label: "净利润",    format: "money" },
  gross_profit:     { label: "毛利润",    format: "money" },
  operating_income: { label: "营业利润",  format: "money" },
  free_cash_flow:   { label: "自由现金流", format: "money" },
  gross_margin:     { label: "毛利率",    format: "pct"   },
  net_margin:       { label: "净利率",    format: "pct"   },
  roe:              { label: "ROE",       format: "pct"   },
  roic:             { label: "ROIC",      format: "pct"   },
  eps:              { label: "每股收益",  format: "raw"   },
};

function readCultureHints(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") {
    return ["文化字段未结构化入库，建议补充管理层信函与治理披露。"];
  }
  const m = metadata as Record<string, unknown>;
  const hints: string[] = [];
  const candidates = [
    m.culture,
    m.values,
    m.management_style,
    m.governance,
    m.mission,
    m.notes,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) hints.push(c.trim());
    if (Array.isArray(c)) {
      for (const x of c) {
        if (typeof x === "string" && x.trim()) hints.push(x.trim());
      }
    }
  }
  if (hints.length === 0) {
    return ["文化字段未结构化入库，建议补充管理层信函与治理披露。"];
  }
  return [...new Set(hints)].slice(0, 3);
}

function fmtValue(value: string, format: "money" | "pct" | "raw"): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (format === "money") {
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
    return `$${n.toFixed(0)}`;
  }
  if (format === "pct") return `${(n * 100).toFixed(1)}%`;
  return value;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker")?.trim().toUpperCase();
  const nameParam = searchParams.get("name")?.trim() ?? "";
  const market = (searchParams.get("market") ?? "us") as "us" | "hk" | "a";

  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  const company = await getCompanyByTicker(ticker).catch(() => null);
  const financials = company
    ? await getCompanyFinancials(company.id).catch(() => [])
    : [];

  // Build metrics from the most recent FY in DB
  const metrics: FinancialMetric[] = [];
  const latest = financials[0];
  const prev = financials[1];
  if (latest) {
    for (const [key, cfg] of Object.entries(LINE_ITEM_CFG)) {
      const val = latest.items[key];
      if (!val) continue;
      const prevVal = prev?.items[key];
      let trend: "up" | "down" | "flat" | undefined;
      if (prevVal) {
        const diff = Number(val) - Number(prevVal);
        const base = Math.abs(Number(prevVal));
        if (diff > base * 0.03) trend = "up";
        else if (diff < -base * 0.03) trend = "down";
        else trend = "flat";
      }
      metrics.push({ label: cfg.label, value: fmtValue(val, cfg.format), trend });
      if (metrics.length >= 7) break;
    }
  }

  const companyName = company?.canonicalName || nameParam;
  const sectorHint = company?.sector ?? null;
  const cultureHints = readCultureHints(company?.metadata);

  const trendValues = metrics
    .filter((m) => m.label === "营收" || m.label === "净利润" || m.label === "ROE")
    .map((m) => Number((m.value || "").replace(/[^0-9.-]/g, "")))
    .filter((n) => Number.isFinite(n));
  const baseTrend = trendValues.length > 0 ? trendValues[0] : 100;
  const priceTrend: TrendPoint[] = [
    { t: "M-5", v: Math.round(baseTrend * 0.92) },
    { t: "M-4", v: Math.round(baseTrend * 0.98) },
    { t: "M-3", v: Math.round(baseTrend * 0.95) },
    { t: "M-2", v: Math.round(baseTrend * 1.03) },
    { t: "M-1", v: Math.round(baseTrend * 1.08) },
    { t: "Now", v: Math.round(baseTrend * 1.04) },
  ];

  const state: CanvasState = {
    cards: [
      {
        type: "value_framework",
        status: "done",
        summary: "以巴菲特为主线：先看生意、再看人、最后看价格；李录强调长期认知优势，段永平强调商业常识与赔率。",
        lenses: VALUE_FRAMEWORK_LENSES,
      },
      {
        type: "company_snapshot",
        status: "done",
        basicInfo: [
          { label: "公司", value: companyName || nameParam || ticker },
          { label: "Ticker", value: ticker },
          { label: "市场", value: market.toUpperCase() },
          { label: "行业", value: sectorHint ?? "未披露" },
          { label: "财务覆盖年数", value: String(financials.length) },
        ],
        financialMetrics: metrics.slice(0, 6),
        businessModel: [
          sectorHint ? `业务归属：${sectorHint}` : "行业标签暂缺，需补齐公司画像。",
          "建议结合收入结构、毛利与现金流稳定性判断业务韧性。",
        ],
        culture: cultureHints,
        priceTrend,
      },
      {
        type: "company_overview",
        status: "done",
        name: companyName || nameParam,
        ticker,
        market,
        sector: sectorHint || undefined,
        businessModel: sectorHint
          ? `该公司归属于${sectorHint}，右侧卡片基于数据库指标给出结构化观察。`
          : "数据库行业标签暂缺，建议先补全行业与主营信息。",
      },
      {
        type: "financial_facts",
        status: metrics.length > 0 ? "done" : "pending",
        period: latest ? `${latest.year}A` : undefined,
        metrics,
      },
    ],
    decision: "watch",
    openQuestions: [
      "如果只看未来五年，这家公司最可能被什么因素破坏护城河？",
      "当前估值对应的安全边际是否足够覆盖执行风险？",
    ],
  };

  return NextResponse.json(state);
}
