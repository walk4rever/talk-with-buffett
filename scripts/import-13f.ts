/**
 * import-13f.ts
 *
 * Fetches SEC EDGAR 13F-HR filings for the three tribe filers and upserts
 * Entity / ExtSource / Holding rows into the database.
 *
 * Usage:
 *   npx tsx scripts/import-13f.ts [--investor buffett|lilu|duan] [--quarters 4]
 *   npx tsx scripts/import-13f.ts --investor buffett --quarter-list 2025Q4,2025Q3
 *   npx tsx scripts/import-13f.ts --investor buffett --from 2024Q1 --to 2025Q4
 *
 * Defaults: all filers, last 4 quarters.
 */
import { PrismaClient } from "@prisma/client";
import { XMLParser } from "fast-xml-parser";
import {
  resolveCompanyNamesFromMaps,
} from "../src/lib/company-name-map";

const db = new PrismaClient();

const zhByTickerDb = new Map<string, string>();
const zhByIssuerDb = new Map<string, string>();
const tickerByIssuerDb = new Map<string, string>();

function resolveNamesDbFirst(canonicalName: string, existingNameZh?: string | null) {
  const resolved = resolveCompanyNamesFromMaps({
    canonicalName,
    existingNameZh,
    maps: {
      zhByTicker: zhByTickerDb,
      zhByIssuer: zhByIssuerDb,
      tickerByIssuer: tickerByIssuerDb,
    },
  });
  return {
    nameZh: resolved.nameZh,
    nameEnShort: resolved.nameEnShort,
    ticker: resolved.ticker,
  };
}

// ─── Filer definitions ──────────────────────────────────────────────────────

const FILERS = [
  {
    tribeId: "buffett",
    name: "Berkshire Hathaway Inc",
    cik: "1067983",
  },
  {
    tribeId: "lilu",
    name: "Himalaya Capital Management LLC",
    cik: "1709323",
  },
  {
    tribeId: "duan",
    name: "H&H International Investment LLC",
    cik: "1759760",
  },
] as const;

// ─── SEC EDGAR helpers ───────────────────────────────────────────────────────

const EDGAR = "https://data.sec.gov";
const HEADERS = {
  "User-Agent": "buffett-tribe research walkklaw@gmail.com",
  Accept: "application/json, text/xml, */*",
};

async function getFilings(cik: string, maxFilings: number) {
  const paddedCik = cik.padStart(10, "0");
  const url = `${EDGAR}/submissions/CIK${paddedCik}.json`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`EDGAR submissions 404 for CIK ${cik}`);
  const data = (await res.json()) as {
    filings: {
      recent: {
        form: string[];
        filingDate: string[];
        accessionNumber: string[];
        reportDate: string[];
        primaryDocument: string[];
      };
    };
  };
  const { form, filingDate, accessionNumber, reportDate, primaryDocument } = data.filings.recent;
  const results: Array<{
    accno: string;
    filedAt: string;
    reportDate: string;
    xmlFile: string;
  }> = [];
  for (let i = 0; i < form.length; i++) {
    if (form[i] === "13F-HR") {
      results.push({
        accno: accessionNumber[i],
        filedAt: filingDate[i],
        reportDate: reportDate[i],
        xmlFile: primaryDocument[i],
      });
      if (results.length >= maxFilings) break;
    }
  }
  return results;
}

function quarterKey(year: number, quarter: number): string {
  return `${year}Q${quarter}`;
}

function parseQuarterToken(token: string): { year: number; quarter: number } | null {
  const normalized = token.trim().toUpperCase().replace(/[\s_-]/g, "");
  const m = normalized.match(/^(\d{4})Q([1-4])$/);
  if (!m) return null;
  return { year: Number(m[1]), quarter: Number(m[2]) };
}

function parseQuarterListArg(raw: string): Array<{ year: number; quarter: number }> {
  const parts = raw.split(",").map((x) => x.trim()).filter(Boolean);
  const parsed = parts.map((p) => {
    const q = parseQuarterToken(p);
    if (!q) throw new Error(`Invalid quarter token: "${p}". Use format like 2025Q4.`);
    return q;
  });

  const uniq = new Map<string, { year: number; quarter: number }>();
  for (const q of parsed) uniq.set(quarterKey(q.year, q.quarter), q);
  return [...uniq.values()];
}

function quarterOrdinal(year: number, quarter: number): number {
  return year * 4 + quarter;
}

function quarterRange(from: { year: number; quarter: number }, to: { year: number; quarter: number }) {
  const start = quarterOrdinal(from.year, from.quarter);
  const end = quarterOrdinal(to.year, to.quarter);
  if (start > end) {
    throw new Error(`Invalid quarter range: from ${quarterKey(from.year, from.quarter)} is after to ${quarterKey(to.year, to.quarter)}.`);
  }

  const list: Array<{ year: number; quarter: number }> = [];
  for (let n = start; n <= end; n++) {
    const year = Math.floor((n - 1) / 4);
    const quarter = ((n - 1) % 4) + 1;
    list.push({ year, quarter });
  }
  return list;
}

async function getInfoTableXml(cik: string, accno: string, primaryDoc: string): Promise<string> {
  const accnoPath = accno.replace(/-/g, "");
  const wwwBase = `https://www.sec.gov/Archives/edgar/data/${cik}/${accnoPath}`;

  // If primaryDoc is a direct XML file, try it first
  if (primaryDoc.endsWith(".xml") && !primaryDoc.includes("/")) {
    const xmlRes = await fetch(`${wwwBase}/${primaryDoc}`, { headers: HEADERS });
    if (xmlRes.ok) return xmlRes.text();
  }

  // Otherwise scrape the directory listing to find the information table XML
  const dirRes = await fetch(`${wwwBase}/`, { headers: HEADERS });
  if (!dirRes.ok) throw new Error(`Directory listing failed: ${wwwBase}/`);
  const html = await dirRes.text();

  // Extract all XML hrefs, exclude cover-page XML
  const xmlFiles = [...html.matchAll(/href="([^"]+\.xml)"/g)]
    .map((m) => m[1].split("/").pop()!)
    .filter((n) => n !== "primary_doc.xml");

  if (xmlFiles.length === 0) throw new Error(`No information table XML found in ${wwwBase}`);

  const xmlFile = xmlFiles[0];
  const xmlRes = await fetch(`${wwwBase}/${xmlFile}`, { headers: HEADERS });
  if (!xmlRes.ok) throw new Error(`XML fetch failed: ${wwwBase}/${xmlFile}`);
  return xmlRes.text();
}

interface InfoTableEntry {
  nameOfIssuer: string;
  titleOfClass: string;
  cusip: string;
  value: bigint; // in USD (the XML reports in $1,000 units)
  shares: bigint;
  investmentDiscretion: string;
  putCall?: string;
}

function parseInfoTable(xml: string): InfoTableEntry[] {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  const doc = parser.parse(xml);

  // Navigate to infoTable array (path varies by filer)
  let tables: unknown[] = [];
  const root = doc?.informationTable ?? doc?.["ns1:informationTable"] ?? doc;
  if (root?.infoTable) {
    tables = Array.isArray(root.infoTable) ? root.infoTable : [root.infoTable];
  }

  const rawEntries = tables.map((t: unknown) => {
    const row = t as Record<string, unknown>;
    const shrsOrPrnAmt = row.shrsOrPrnAmt as Record<string, unknown> | undefined;
    const sharesRaw = shrsOrPrnAmt?.sshPrnamt ?? row.sshPrnamt ?? 0;
    // SEC 13F value field is in full USD (despite the spec saying $1,000 units,
    // actual EDGAR filings use full dollar amounts in the XML)
    const valueRaw = Number(row.value ?? 0);

    return {
      nameOfIssuer: String(row.nameOfIssuer ?? ""),
      titleOfClass: String(row.titleOfClass ?? ""),
      cusip: String(row.cusip ?? ""),
      value: BigInt(Math.round(valueRaw)),
      shares: BigInt(Number(sharesRaw)),
      investmentDiscretion: String(row.investmentDiscretion ?? "SOLE"),
      putCall: row.putCall != null ? String(row.putCall) : undefined,
    };
  });

  // Aggregate by CUSIP — some filers (e.g. Berkshire) split the same security
  // across multiple sub-managers, each appearing as a separate infoTable row.
  const byCusip = new Map<string, InfoTableEntry>();
  for (const e of rawEntries) {
    const existing = byCusip.get(e.cusip);
    if (existing) {
      byCusip.set(e.cusip, { ...existing, value: existing.value + e.value, shares: existing.shares + e.shares });
    } else {
      byCusip.set(e.cusip, e);
    }
  }
  return [...byCusip.values()];
}

function parseReportDate(reportDate: string): { year: number; quarter: number; date: Date } {
  // reportDate: "2025-12-31"
  const d = new Date(reportDate);
  const month = d.getUTCMonth() + 1;
  const quarter = Math.ceil(month / 3);
  return { year: d.getUTCFullYear(), quarter, date: d };
}

// ─── DB upsert helpers ───────────────────────────────────────────────────────

// In-memory cache: cusip → entity id, seeded from DB at startup
const entityCache = new Map<string, string>(); // cusip → entity.id
const backfilledCusips = new Set<string>();
const companyByTickerCache = new Map<string, string>(); // ticker → company entity.id

async function seedEntityCache() {
  const entities = await db.entity.findMany({
    where: {
      type: "security",
    },
    select: { id: true, metadata: true },
  });
  for (const e of entities) {
    const meta = e.metadata as Record<string, unknown> | null;
    if (meta?.cusip && typeof meta.cusip === "string") {
      entityCache.set(meta.cusip, e.id);
    }
  }

  const companies = await db.entity.findMany({
    where: { type: "company", ticker: { not: null } },
    select: { id: true, ticker: true },
  });
  for (const c of companies) {
    if (c.ticker) companyByTickerCache.set(c.ticker.toUpperCase(), c.id);
  }
  console.log(`  Entity cache seeded: ${entityCache.size} security entities by cusip`);

  const dbMaps = await db.companyNameMap.findMany({
    where: { keyType: { in: ["ticker", "issuer"] } },
    select: { keyType: true, key: true, nameZh: true, ticker: true },
  });
  for (const row of dbMaps) {
    if (row.keyType === "ticker") {
      if (row.nameZh) zhByTickerDb.set(row.key.toUpperCase(), row.nameZh);
    } else if (row.keyType === "issuer") {
      if (row.nameZh) zhByIssuerDb.set(row.key, row.nameZh);
      if (row.ticker) tickerByIssuerDb.set(row.key, row.ticker.toUpperCase());
    }
  }
  console.log(`  Name map cache seeded: ${dbMaps.length} rows`);
}

async function upsertFilerEntity(filer: (typeof FILERS)[number]) {
  return db.entity.upsert({
    where: { cik: filer.cik },
    create: {
      type: "master",
      canonicalName: filer.name,
      cik: filer.cik,
      tribeId: filer.tribeId,
    },
    update: { type: "master", tribeId: filer.tribeId, canonicalName: filer.name },
  });
}

async function upsertSecurityEntity(entry: InfoTableEntry): Promise<string> {
  const namesFromEntry = resolveNamesDbFirst(entry.nameOfIssuer);
  const maybeCompanyId =
    (namesFromEntry.ticker ? companyByTickerCache.get(namesFromEntry.ticker.toUpperCase()) : undefined) ?? null;

  const cached = entityCache.get(entry.cusip);
  if (cached) {
    if (!backfilledCusips.has(entry.cusip)) {
      const row = await db.entity.findUnique({
        where: { id: cached },
        select: { metadata: true, canonicalName: true },
      });
      if (row) {
        const meta = (row.metadata as Record<string, unknown> | null) ?? {};
        const names = resolveNamesDbFirst(
          row.canonicalName || entry.nameOfIssuer,
          typeof meta.nameZh === "string" ? meta.nameZh : null,
        );
        await db.entity.update({
          where: { id: cached },
          data: {
            canonicalName: entry.nameOfIssuer,
            ticker: names.ticker,
            metadata: {
              ...meta,
              cusip: entry.cusip,
              titleOfClass: entry.titleOfClass,
              nameZh: names.nameZh,
              nameEnShort: names.nameEnShort,
              companyEntityId:
                typeof meta.companyEntityId === "string" ? meta.companyEntityId : maybeCompanyId,
            },
          },
        });
      }
      backfilledCusips.add(entry.cusip);
    }
    return cached;
  }

  const existing = await db.entity.findFirst({
    where: { type: "security", metadata: { path: ["cusip"], equals: entry.cusip } },
    select: { id: true, metadata: true, canonicalName: true },
  });
  if (existing) {
    const meta = (existing.metadata as Record<string, unknown> | null) ?? {};
    const names = resolveNamesDbFirst(
      existing.canonicalName || entry.nameOfIssuer,
      typeof meta.nameZh === "string" ? meta.nameZh : null,
    );
    const nextMeta = {
      ...meta,
      cusip: entry.cusip,
      titleOfClass: entry.titleOfClass,
      nameZh: names.nameZh,
      nameEnShort: names.nameEnShort,
      companyEntityId:
        typeof meta.companyEntityId === "string" ? meta.companyEntityId : maybeCompanyId,
    };
    await db.entity.update({
      where: { id: existing.id },
      data: {
        canonicalName: entry.nameOfIssuer,
        ticker: names.ticker,
        metadata: nextMeta,
      },
    });
    backfilledCusips.add(entry.cusip);
    entityCache.set(entry.cusip, existing.id);
    return existing.id;
  }

  // Not in cache — create and cache
  const created = await db.entity.create({
    data: {
      type: "security",
      canonicalName: entry.nameOfIssuer,
      ticker: namesFromEntry.ticker,
      metadata: {
        cusip: entry.cusip,
        titleOfClass: entry.titleOfClass,
        nameZh: namesFromEntry.nameZh,
        nameEnShort: namesFromEntry.nameEnShort,
        companyEntityId: maybeCompanyId,
      },
    },
  }).catch(async () => {
    // Race condition: another process created it; fetch it
    const found = await db.entity.findFirst({
      where: { metadata: { path: ["cusip"], equals: entry.cusip } },
    });
    if (!found) throw new Error(`Entity not found after conflict: ${entry.cusip}`);
    return found;
  });

  entityCache.set(entry.cusip, created.id);
  backfilledCusips.add(entry.cusip);
  return created.id;
}

async function ensureSecurityProfile(entityId: string) {
  const e = await db.entity.findUnique({
    where: { id: entityId },
    select: { id: true, ticker: true, metadata: true },
  });
  if (!e) return null;
  const meta = (e.metadata as Record<string, unknown> | null) ?? {};
  const companyEntityId = typeof meta.companyEntityId === "string" ? meta.companyEntityId : null;
  const cusip = typeof meta.cusip === "string" ? meta.cusip : null;
  const titleOfClass = typeof meta.titleOfClass === "string" ? meta.titleOfClass : null;

  const security = await db.security.upsert({
    where: { entityId: e.id },
    create: {
      entityId: e.id,
      companyEntityId,
      ticker: e.ticker,
      cusip,
      titleOfClass,
      metadata: meta,
    },
    update: {
      companyEntityId,
      ticker: e.ticker,
      cusip,
      titleOfClass,
      metadata: meta,
    },
    select: { id: true },
  });
  return security.id;
}

async function importFiling(
  filerEntityId: string,
  accno: string,
  cik: string,
  filedAt: string,
  reportDate: string,
  entries: InfoTableEntry[],
) {
  const { year, quarter, date } = parseReportDate(reportDate);
  const asOfDate = date;

  // Total portfolio value for percentage calculation
  const totalValue = entries.reduce((sum, e) => sum + e.value, BigInt(0));

  // Find or create ExtSource (one per filer × quarter)
  const existingSource = await db.extSource.findFirst({
    where: { filerEntityId, periodYear: year, periodQuarter: quarter, kind: "13f" },
  });
  const extSource = existingSource ?? await db.extSource.create({
    data: {
      kind: "13f",
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accno.replace(/-/g, "")}`,
      ts: asOfDate,
      periodYear: year,
      periodQuarter: quarter,
      filedAt: new Date(filedAt),
      filerEntityId,
      metadata: { accno, cik },
    },
  });

  // Upsert holdings
  let imported = 0;
  for (const entry of entries) {
    const securityEntityId = await upsertSecurityEntity(entry);
    const securityId = await ensureSecurityProfile(securityEntityId);
    const percentOfPortfolio =
      totalValue > BigInt(0)
        ? Number((entry.value * BigInt(10000)) / totalValue) / 100
        : 0;

    await db.holding.upsert({
      where: {
        holderEntityId_securityEntityId_asOfDate: {
          holderEntityId: filerEntityId,
          securityEntityId: securityEntityId,
          asOfDate,
        },
      },
      create: {
        holderEntityId: filerEntityId,
        securityEntityId: securityEntityId,
        sourceId: extSource.id,
        securityId,
        asOfDate,
        shares: entry.shares,
        valueUsd: entry.value,
        percentOfPortfolio,
      },
      update: {
        sourceId: extSource.id,
        securityId,
        shares: entry.shares,
        valueUsd: entry.value,
        percentOfPortfolio,
      },
    });
    imported++;
  }

  return { imported, year, quarter };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const filerArg =
    args.find((_, i) => args[i - 1] === "--filer") ??
    args.find((_, i) => args[i - 1] === "--investor");
  const quartersArg = args.find((_, i) => args[i - 1] === "--quarters");
  const quarterListArg =
    args.find((_, i) => args[i - 1] === "--quarter-list") ??
    args.find((_, i) => args[i - 1] === "--quarters-list");
  const fromArg = args.find((_, i) => args[i - 1] === "--from");
  const toArg = args.find((_, i) => args[i - 1] === "--to");
  const maxQuarters = quartersArg ? parseInt(quartersArg, 10) : 4;
  if (quarterListArg && (fromArg || toArg)) {
    throw new Error("Use either --quarter-list or --from/--to, not both.");
  }
  if ((fromArg && !toArg) || (!fromArg && toArg)) {
    throw new Error("Both --from and --to are required when using quarter range mode.");
  }

  let quarterList: Array<{ year: number; quarter: number }> = [];
  if (quarterListArg) {
    quarterList = parseQuarterListArg(quarterListArg);
  } else if (fromArg && toArg) {
    const from = parseQuarterToken(fromArg);
    const to = parseQuarterToken(toArg);
    if (!from || !to) {
      throw new Error(`Invalid --from/--to value. Use format like 2024Q1, 2025Q4.`);
    }
    quarterList = quarterRange(from, to);
  }
  const quarterSet = new Set(quarterList.map((q) => quarterKey(q.year, q.quarter)));

  const filersToRun = filerArg
    ? FILERS.filter((f) => f.tribeId === filerArg)
    : FILERS;

  if (filerArg && filersToRun.length === 0) {
    console.error(`Unknown filer: ${filerArg}. Use buffett, lilu, or duan.`);
    process.exit(1);
  }

  await seedEntityCache();

  for (const filer of filersToRun) {
    console.log(`\n── ${filer.name} (CIK ${filer.cik}) ──`);

    const filerEntity = await upsertFilerEntity(filer);
    console.log(`  Entity: ${filerEntity.id}`);

    const fetchCount = quarterList.length > 0 ? 120 : maxQuarters;
    const filings = await getFilings(filer.cik, fetchCount);
    console.log(`  Found ${filings.length} 13F filings (fetched window: ${fetchCount})`);

    const filingsToImport = quarterList.length > 0
      ? filings.filter((f) => {
          const { year, quarter } = parseReportDate(f.reportDate);
          return quarterSet.has(quarterKey(year, quarter));
        })
      : filings;

    if (quarterList.length > 0) {
      const foundSet = new Set(
        filingsToImport.map((f) => {
          const { year, quarter } = parseReportDate(f.reportDate);
          return quarterKey(year, quarter);
        }),
      );
      const missing = quarterList
        .map((q) => quarterKey(q.year, q.quarter))
        .filter((k) => !foundSet.has(k));
      if (missing.length > 0) {
        console.warn(`  Missing requested quarters in fetched window: ${missing.join(", ")}`);
      }
    }

    for (const filing of filingsToImport) {
      console.log(`  Filing ${filing.accno} (${filing.reportDate}, filed ${filing.filedAt}) → ${filing.xmlFile}`);
      try {
        const xml = await getInfoTableXml(filer.cik, filing.accno, filing.xmlFile);
        const entries = parseInfoTable(xml);
        console.log(`    Parsed ${entries.length} positions`);
        if (entries.length === 0) {
          console.warn("    ⚠ No positions parsed — check XML structure");
          continue;
        }
        const { imported, year, quarter } = await importFiling(
          filerEntity.id,
          filing.accno,
          filer.cik,
          filing.filedAt,
          filing.reportDate,
          entries,
        );
        console.log(`    ✓ ${imported} holdings saved for Q${quarter} ${year}`);
      } catch (err) {
        console.error(`    ✗ Error: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
