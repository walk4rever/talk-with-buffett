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
import { issuerKey, normalizeEnglishName } from "../src/lib/company-name-map";
import { translateCompanyNameToZh, upsertNameMapEntries } from "./lib/company-name-zh";

const db = new PrismaClient();

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
  form: string;
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
  tagsUsGaap: string[];
  tagsIfrs: string[];
  unitCandidates: string[];
};

const LINE_ITEMS: LineItemConfig[] = [
  {
    key: "Revenue",
    tagsUsGaap: ["RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "Revenues"],
    tagsIfrs: ["Revenue"],
    unitCandidates: ["USD"],
  },
  { key: "GrossProfit", tagsUsGaap: ["GrossProfit"], tagsIfrs: ["GrossProfit"], unitCandidates: ["USD"] },
  {
    key: "OperatingIncome",
    tagsUsGaap: ["OperatingIncomeLoss"],
    tagsIfrs: ["ProfitLossFromOperatingActivities"],
    unitCandidates: ["USD"],
  },
  { key: "NetIncome", tagsUsGaap: ["NetIncomeLoss"], tagsIfrs: ["ProfitLoss"], unitCandidates: ["USD"] },
  {
    key: "OperatingCashFlow",
    tagsUsGaap: ["NetCashProvidedByUsedInOperatingActivities"],
    tagsIfrs: ["CashFlowsFromUsedInOperatingActivities"],
    unitCandidates: ["USD"],
  },
  { key: "TotalAssets", tagsUsGaap: ["Assets"], tagsIfrs: ["Assets"], unitCandidates: ["USD"] },
  { key: "TotalLiabilities", tagsUsGaap: ["Liabilities"], tagsIfrs: ["Liabilities"], unitCandidates: ["USD"] },
  {
    key: "ShareholdersEquity",
    tagsUsGaap: ["StockholdersEquity"],
    tagsIfrs: ["EquityAttributableToOwnersOfParent", "Equity"],
    unitCandidates: ["USD"],
  },
  {
    key: "EPSBasic",
    tagsUsGaap: ["EarningsPerShareBasic"],
    tagsIfrs: ["BasicEarningsLossPerShare"],
    unitCandidates: ["USD/shares", "USD-per-shares", "pure"],
  },
  {
    key: "EPSDiluted",
    tagsUsGaap: ["EarningsPerShareDiluted"],
    tagsIfrs: ["DilutedEarningsLossPerShare"],
    unitCandidates: ["USD/shares", "USD-per-shares", "pure"],
  },
];

const TICKER_ALIASES: Record<string, string> = {
  "BRK.B": "BRK-B",
  "BRK.A": "BRK-A",
  LLIVE: "LLYVK",
  YY: "JOYY",
};

const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "20-F", "20-F/A"]);
const zhByTickerDb = new Map<string, string>();

function normalizeTicker(ticker: string): string {
  const raw = ticker.trim().toUpperCase();
  return TICKER_ALIASES[raw] ?? raw;
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

async function getRecentAnnualFilings(cik: string): Promise<FilingMeta[]> {
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
    const form = recent.form[i];
    if (!ANNUAL_FORMS.has(form)) continue;
    filings.push({
      accession: recent.accessionNumber[i],
      filedAt: recent.filingDate[i],
      reportDate: recent.reportDate[i],
      primaryDocument: recent.primaryDocument[i],
      form,
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
      "ifrs-full"?: Record<string, { units?: Record<string, QuarterFact[]> }>;
    };
  }>;
}

function findBestFactValue(
  facts: Awaited<ReturnType<typeof getCompanyFacts>>,
  tagsUsGaap: string[],
  tagsIfrs: string[],
  unitCandidates: string[],
  reportDate: string,
) {
  const gaap = facts.facts?.["us-gaap"] ?? {};
  const ifrs = facts.facts?.["ifrs-full"] ?? {};
  const candidates: Array<{ filed: string; val: number }> = [];

  const conceptSets = [
    { concepts: gaap, tags: tagsUsGaap },
    { concepts: ifrs, tags: tagsIfrs },
  ];

  for (const set of conceptSets) {
    for (const tag of set.tags) {
      const concept = set.concepts[tag];
      if (!concept?.units) continue;

      const preferredUnitRows = unitCandidates.flatMap((unit) => {
        const rows = concept.units?.[unit];
        return rows ?? [];
      });
      const rowsToCheck =
        preferredUnitRows.length > 0
          ? preferredUnitRows
          : Object.values(concept.units).flat();

      for (const row of rowsToCheck) {
        if (!row || row.end !== reportDate || typeof row.val !== "number") continue;
        if (!ANNUAL_FORMS.has(row.form ?? "")) continue;
        candidates.push({
          filed: row.filed ?? "0000-00-00",
          val: row.val,
        });
      }

      if (candidates.length) break;
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
  const byCik = await db.entity.findFirst({
    where: { cik },
    select: { id: true, metadata: true, type: true, cik: true },
  });
  const cikOwnedByCompany = byCik?.type === "company";
  const byTicker = byCik
    ? byCik.type === "company"
      ? null
      : await db.entity.findFirst({
        where: {
          type: "company",
          ticker: { equals: ticker, mode: "insensitive" },
        },
        select: { id: true, metadata: true, cik: true },
      })
    : await db.entity.findFirst({
      where: {
        type: "company",
        ticker: { equals: ticker, mode: "insensitive" },
      },
      select: { id: true, metadata: true, cik: true },
    });

  const target = cikOwnedByCompany ? byCik : byTicker;
  const existingMeta = (target?.metadata as Record<string, unknown> | null) ?? {};
  const dbNameMap = await db.companyNameMap.findUnique({
    where: { keyType_key: { keyType: "ticker", key: ticker.toUpperCase() } },
    select: { nameZh: true },
  });
  const existingZh =
    dbNameMap?.nameZh ??
    (typeof existingMeta.nameZh === "string" ? existingMeta.nameZh : null);
  const nameEnShort = normalizeEnglishName(title);
  let nameZh = zhByTickerDb.get(ticker.toUpperCase()) ?? existingZh;
  if (!nameZh) {
    nameZh = await translateCompanyNameToZh({
      englishName: title,
      ticker,
    });
    const mapIssuerKey = issuerKey(title);
    await upsertNameMapEntries({
      db,
      issuerKey: mapIssuerKey,
      ticker,
      nameZh,
      nameEnShort,
      source: "import-translation",
    });
    zhByTickerDb.set(ticker.toUpperCase(), nameZh);
  }

  const nextMeta = {
    ...existingMeta,
    source: "sec-edgar",
    importedBy: "import-10k-xbrl",
    nameZh,
    nameEnShort,
  };

  if (target) {
    const canSetCik = byCik == null || (byCik.type === "company" && byCik.id === target.id);
    return db.entity.update({
      where: { id: target.id },
      data: {
        canonicalName: title,
        cik: canSetCik ? cik : target.cik,
        ticker,
        metadata: {
          ...nextMeta,
          ...(canSetCik ? {} : { secCik: cik }),
        },
      },
    });
  }

  // CIK may already be occupied by a non-company entity (e.g. master/filer).
  // Keep SEC CIK in metadata to avoid unique-key collision on Entity.cik.
  const createCik = byCik == null ? cik : null;
  return db.entity.create({
    data: {
      type: "company",
      canonicalName: title,
      cik: createCik,
      ticker,
      metadata: {
        ...nextMeta,
        ...(createCik ? {} : { secCik: cik }),
      },
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
      kind: filing.form.startsWith("20-F") ? "20f" : "10k",
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
        form: filing.form,
      },
    },
  });
}

async function import10kForTicker(ticker: string, fromYear: number, toYear: number) {
  if (!zhByTickerDb.size) {
    const maps = await db.companyNameMap.findMany({
      where: { keyType: "ticker" },
      select: { key: true, nameZh: true },
    });
    for (const row of maps) {
      if (row.nameZh) zhByTickerDb.set(row.key.toUpperCase(), row.nameZh);
    }
  }

  const tickerMap = await getTickerCikMap();
  const resolved = tickerMap.get(ticker);
  if (!resolved) throw new Error(`Ticker not found in SEC ticker map: ${ticker}`);

  const { cik, title } = resolved;
  console.log(`Ticker ${ticker} -> CIK ${cik} (${title})`);

  const companyEntity = await upsertCompanyEntity(cik, ticker, title);
  const [filings, facts] = await Promise.all([
    getRecentAnnualFilings(cik),
    getCompanyFacts(cik),
  ]);

  const targetFilings = filings
    .filter((f) => {
      const y = new Date(f.reportDate).getUTCFullYear();
      return y >= fromYear && y <= toYear;
    })
    .sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1));

  console.log(`Found ${targetFilings.length} annual filings (10-K/20-F) in ${fromYear}-${toYear}`);
  if (!targetFilings.length) return;

  for (const filing of targetFilings) {
    const extSource = await upsertExtSource(companyEntity.id, cik, filing);
    let upserted = 0;
    let missing = 0;

    for (const item of LINE_ITEMS) {
      const value = findBestFactValue(
        facts,
        item.tagsUsGaap,
        item.tagsIfrs,
        item.unitCandidates,
        filing.reportDate,
      );
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
