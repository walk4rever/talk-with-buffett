import { NextResponse } from "next/server";
import { getCompanyByTicker, getCompanyFinancials } from "@/lib/company-data";
import type { CanvasState, FinancialMetric } from "@/types/canvas";

export const maxDuration = 30;

const AI_API_KEY = process.env.AI_API_KEY!;
const AI_API_BASE_URL = process.env.AI_API_BASE_URL!;
const AI_MODEL = process.env.AI_MODEL!;

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

interface Analysis {
  overview: string;
  sector: string;
  business: string;
  people: string;
  price: string;
}

async function generateAnalysis(
  name: string,
  ticker: string,
  sectorHint: string | null,
  financialSummary: string,
): Promise<Analysis> {
  const prompt = `你是巴菲特风格的投资分析师，用中文对以下公司做简洁分析。

公司：${name} (${ticker})${sectorHint ? `\n行业：${sectorHint}` : ""}${financialSummary ? `\n近期财务：${financialSummary}` : ""}

输出纯JSON，不要加代码块标记：
{
  "overview": "业务模式一句话（≤30字）",
  "sector": "行业分类（≤10字）",
  "business": "护城河判断与核心风险（≤60字）",
  "people": "管理层资本分配与诚信评价（≤50字）",
  "price": "当前估值所处位置提示（≤50字）"
}`;

  const res = await fetch(`${AI_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 400,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) throw new Error(`AI error: ${res.status}`);
  const data = await res.json();
  const raw = (data.choices?.[0]?.message?.content ?? "").trim();
  const cleaned = raw.replace(/^```[a-z]*\n?/m, "").replace(/```\s*$/m, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return { overview: "", sector: sectorHint ?? "", business: "", people: "", price: "" };
  }
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

  const financialSummary = metrics.map((m) => `${m.label} ${m.value}`).join("、");
  const companyName = company?.canonicalName || nameParam;
  const sectorHint = company?.sector ?? null;

  let analysis: Analysis = {
    overview: "",
    sector: sectorHint ?? "",
    business: "",
    people: "",
    price: "",
  };
  try {
    analysis = await generateAnalysis(companyName, ticker, sectorHint, financialSummary);
  } catch (err) {
    console.error("[canvas] AI analysis failed:", err);
  }

  const state: CanvasState = {
    cards: [
      {
        type: "company_overview",
        status: "done",
        name: companyName || nameParam,
        ticker,
        market,
        sector: analysis.sector || sectorHint || undefined,
        businessModel: analysis.overview || undefined,
      },
      {
        type: "financial_facts",
        status: metrics.length > 0 ? "done" : "pending",
        period: latest ? `${latest.year}A` : undefined,
        metrics,
      },
      {
        type: "right_business",
        status: analysis.business ? "done" : "pending",
        conclusion: analysis.business,
        supporting: [],
        counter: [],
        confidence: 0.5,
      },
      {
        type: "right_people",
        status: analysis.people ? "done" : "pending",
        conclusion: analysis.people,
        supporting: [],
        counter: [],
        confidence: 0.5,
      },
      {
        type: "right_price",
        status: analysis.price ? "done" : "pending",
        conclusion: analysis.price,
        supporting: [],
        counter: [],
        confidence: 0.5,
      },
    ],
    decision: "watch",
    openQuestions: [],
  };

  return NextResponse.json(state);
}
