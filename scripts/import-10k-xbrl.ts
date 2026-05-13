/**
 * import-10k-xbrl.ts
 *
 * Import annual 10-K financial line items from SEC EDGAR XBRL CompanyFacts.
 *
 * Usage:
 *   npm run import:10k -- --ticker AAPL --from 2021 --to 2024
 *   npm run import:10k -- --ticker MSFT --years 5
 *
 * Defaults:
 *   --years 5 (if --from/--to not provided)
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function normalizeEnglishName(name: string): string {
  return name
    .replace(/\b(INC|CORP|CORPORATION|CO|COMPANY|HOLDINGS|HLDGS|GROUP|PLC|LTD|LLC|CL A|CL B|COM|SER [A-Z])\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

const ZH_BY_TICKER: Record<string, string> = {
  AAPL: "苹果",
  BAC: "美国银行",
  AXP: "美国运通",
  KO: "可口可乐",
  OXY: "西方石油",
  CVX: "雪佛龙",
  AMZN: "亚马逊",
  GOOGL: "谷歌",
  GOOG: "谷歌",
  MCO: "穆迪",
  DVA: "达维塔",
};

function resolveCompanyNames(input: {
  ticker?: string | null;
  canonicalName: string;
  existingNameZh?: string | null;
}) {
  const ticker = input.ticker?.toUpperCase() ?? null;
  const en = normalizeEnglishName(input.canonicalName);
  const zh = input.existingNameZh ?? (ticker ? ZH_BY_TICKER[ticker] : undefined) ?? en;
  return { nameZh: zh, nameEnShort: en };
}

const EDGAR = "https://data.sec.gov";
const SEC_WWW = "https://www.sec.gov";
const HEADERS = {
  "User-Agent": "buffett-tribe research walkklaw@gmail.com",
  Accept: "application/json, text/xml, */*",
};

type FilingMeta = {
  accession: string;
  filedAt: string;
  reportDate: string;
  primaryDocument: string;
};

type QuarterFact = {
  end?: string;
  filed?: string;
  val?: number;
  form?: string;
  fy?: number;
  fp?: string;
};

type LineItemConfig = {
  key: string;
  tags: string[];
  unitCandidates: string[];
};

const LINE_ITEMS: LineItemConfig[] = [
  { key: "Revenue", tags: ["RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "Revenues"], unitCandidates: ["USD"] },
  { key: "GrossProfit", tags: ["GrossProfit"], unitCandidates: ["USD"] },
  { key: "OperatingIncome", tags: ["OperatingIncomeLoss"], unitCandidates: ["USD"] },
  { key: "NetIncome", tags: ["NetIncomeLoss"], unitCandidates: ["USD"] },
  { key: "OperatingCashFlow", tags: ["NetCashProvidedByUsedInOperatingActivities"], unitCandidates: ["USD"] },
  { key: "TotalAssets", tags: ["Assets"], unitCandidates: ["USD"] },
  { key: "TotalLiabilities", tags: ["Liabilities"], unitCandidates: ["USD"] },
  { key: "ShareholdersEquity", tags: ["StockholdersEquity"], unitCandidates: ["USD"] },
  { key: "EPSBasic", tags: ["EarningsPerShareBasic"], unitCandidates: ["USD/shares", "USD-per-shares", "pure"] },
  { key: "EPSDiluted", tags: ["EarningsPerShareDiluted"], unitCandidates: ["USD/shares", "USD-per-shares", "pure"] },
];

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function parseArgs(args: string[]) {
  const ticker = normalizeTicker(args.find((_, i) => args[i - 1] === "--ticker") ?? "");
  const fromArg = args.find((_, i) => args[i - 1] === "--from");
  const toArg = args.find((_, i) => args[i - 1] === "--to");
  const yearsArg = args.find((_, i) => args[i - 1] === "--years");
  const years = yearsArg ? parseInt(yearsArg, 10) : 5;

  if (!ticker) {
    throw new Error("Missing --ticker. Example: --ticker AAPL");
  }
  if ((fromArg && !toArg) || (!fromArg && toArg)) {
    throw new Error("--from and --to must be used together.");
  }

  let fromYear: number;
  let toYear: number;
  if (fromArg && toArg) {
    fromYear = parseInt(fromArg, 10);
    toYear = parseInt(toArg, 10);
    if (Number.isNaN(fromYear) || Number.isNaN(toYear)) {
      throw new Error("Invalid --from/--to year.");
    }
    if (fromYear > toYear) {
      throw new Error("--from cannot be greater than --to.");
    }
  } else {
    const now = new Date();
    toYear = now.getUTCFullYear();
    fromYear = toYear - years + 1;
  }

  return { ticker, fromYear, toYear };
}

async function getTickerCikMap() {
  const res = await fetch(`${SEC_WWW}/files/company_tickers.json`, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Ticker map fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
  const map = new Map<string, { cik: string; title: string }>();
  for (const item of Object.values(data)) {
    map.set(item.ticker.toUpperCase(), { cik: String(item.cik_str), title: item.title });
  }
  return map;
}

async function getRecent10kFilings(cik: string): Promise<FilingMeta[]> {
  const padded = cik.padStart(10, "0");
  const res = await fetch(`${EDGAR}/submissions/CIK${padded}.json`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Submissions fetch failed for CIK ${cik}`);
  const data = (await res.json()) as {
    filings: {
      recent: {
        form: string[];
        filingDate: string[];
        reportDate: string[];
        accessionNumber: string[];
        primaryDocument: string[];
      };
    };
  };

  const recent = data.filings.recent;
  const filings: FilingMeta[] = [];
  for (let i = 0; i < recent.form.length; i++) {
    if (recent.form[i] !== "10-K" && recent.form[i] !== "10-K/A") continue;
    filings.push({
      accession: recent.accessionNumber[i],
      filedAt: recent.filingDate[i],
      reportDate: recent.reportDate[i],
      primaryDocument: recent.primaryDocument[i],
    });
  }
  return filings;
}

async function getCompanyFacts(cik: string) {
  const padded = cik.padStart(10, "0");
  const res = await fetch(`${EDGAR}/api/xbrl/companyfacts/CIK${padded}.json`, { headers: HEADERS });
  if (!res.ok) throw new Error(`CompanyFacts fetch failed for CIK ${cik}`);
  return res.json() as Promise<{
    facts?: {
      "us-gaap"?: Record<string, { units?: Record<string, QuarterFact[]> }>;
    };
  }>;
}

function findBestFactValue(
  facts: Awaited<ReturnType<typeof getCompanyFacts>>,
  tags: string[],
  unitCandidates: string[],
  reportDate: string,
) {
  const gaap = facts.facts?.["us-gaap"] ?? {};
  const candidates: Array<{ filed: string; val: number }> = [];

  for (const tag of tags) {
    const concept = gaap[tag];
    if (!concept?.units) continue;

    for (const unit of unitCandidates) {
      const rows = concept.units[unit];
      if (!rows) continue;
      for (const row of rows) {
        if (!row || row.end !== reportDate || typeof row.val !== "number") continue;
        if (row.form !== "10-K" && row.form !== "10-K/A") continue;
        candidates.push({
          filed: row.filed ?? "0000-00-00",
          val: row.val,
        });
      }
    }

    if (candidates.length) break;
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => (a.filed < b.filed ? 1 : -1));
  return candidates[0].val;
}

function decimalFromNumber(value: number) {
  if (!Number.isFinite(value)) return null;
  return value.toString();
}

async function upsertCompanyEntity(cik: string, ticker: string, title: string) {
  const byCik = await db.entity.findUnique({
    where: { cik },
    select: { id: true, metadata: true },
  });
  const byTicker = byCik
    ? null
    : await db.entity.findFirst({
      where: {
        type: "company",
        ticker: { equals: ticker, mode: "insensitive" },
      },
      select: { id: true, metadata: true },
    });

  const target = byCik ?? byTicker;
  const existingMeta = (target?.metadata as Record<string, unknown> | null) ?? {};
  const existingZh = typeof existingMeta.nameZh === "string" ? existingMeta.nameZh : null;
  const names = resolveCompanyNames({
    ticker,
    canonicalName: title,
    existingNameZh: existingZh,
  });

  const nextMeta = {
    ...existingMeta,
    source: "sec-edgar",
    importedBy: "import-10k-xbrl",
    nameZh: names.nameZh,
    nameEnShort: names.nameEnShort,
  };

  if (target) {
    return db.entity.update({
      where: { id: target.id },
      data: {
        canonicalName: title,
        cik,
        ticker,
        metadata: nextMeta,
      },
    });
  }

  return db.entity.create({
    data: {
      type: "company",
      canonicalName: title,
      cik,
      ticker,
      metadata: nextMeta,
    },
  });
}

async function upsertExtSource(
  entityId: string,
  cik: string,
  filing: FilingMeta,
) {
  const year = new Date(filing.reportDate).getUTCFullYear();
  const quarter = Math.ceil((new Date(filing.reportDate).getUTCMonth() + 1) / 3);
  const accnoPath = filing.accession.replace(/-/g, "");

  const existing = await db.extSource.findFirst({
    where: {
      kind: "10k",
      filerEntityId: entityId,
      periodYear: year,
      periodQuarter: quarter,
      filedAt: new Date(filing.filedAt),
    },
  });
  if (existing) return existing;

  return db.extSource.create({
    data: {
      kind: "10k",
      filerEntityId: entityId,
      periodYear: year,
      periodQuarter: quarter,
      ts: new Date(filing.reportDate),
      filedAt: new Date(filing.filedAt),
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accnoPath}/${filing.primaryDocument}`,
      metadata: {
        accession: filing.accession,
        primaryDocument: filing.primaryDocument,
        form: "10-K",
      },
    },
  });
}

async function import10kForTicker(ticker: string, fromYear: number, toYear: number) {
  const tickerMap = await getTickerCikMap();
  const resolved = tickerMap.get(ticker);
  if (!resolved) throw new Error(`Ticker not found in SEC ticker map: ${ticker}`);

  const { cik, title } = resolved;
  console.log(`Ticker ${ticker} -> CIK ${cik} (${title})`);

  const companyEntity = await upsertCompanyEntity(cik, ticker, title);
  const [filings, facts] = await Promise.all([
    getRecent10kFilings(cik),
    getCompanyFacts(cik),
  ]);

  const targetFilings = filings
    .filter((f) => {
      const y = new Date(f.reportDate).getUTCFullYear();
      return y >= fromYear && y <= toYear;
    })
    .sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1));

  console.log(`Found ${targetFilings.length} 10-K filings in ${fromYear}-${toYear}`);
  if (!targetFilings.length) return;

  for (const filing of targetFilings) {
    const extSource = await upsertExtSource(companyEntity.id, cik, filing);
    let upserted = 0;
    let missing = 0;

    for (const item of LINE_ITEMS) {
      const value = findBestFactValue(facts, item.tags, item.unitCandidates, filing.reportDate);
      if (value == null) {
        missing++;
        continue;
      }

      await db.financial.upsert({
        where: {
          entityId_periodEnd_periodType_lineItem: {
            entityId: companyEntity.id,
            periodEnd: new Date(filing.reportDate),
            periodType: "FY",
            lineItem: item.key,
          },
        },
        create: {
          entityId: companyEntity.id,
          sourceId: extSource.id,
          periodEnd: new Date(filing.reportDate),
          periodType: "FY",
          lineItem: item.key,
          value: decimalFromNumber(value),
          unit: item.unitCandidates[0],
        },
        update: {
          sourceId: extSource.id,
          value: decimalFromNumber(value),
          unit: item.unitCandidates[0],
        },
      });
      upserted++;
    }

    console.log(
      `  ${filing.reportDate} (${filing.accession}) -> upserted ${upserted}, missing ${missing}`,
    );
  }
}

async function main() {
  const { ticker, fromYear, toYear } = parseArgs(process.argv.slice(2));
  await import10kForTicker(ticker, fromYear, toYear);
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
