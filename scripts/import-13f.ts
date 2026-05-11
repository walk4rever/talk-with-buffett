/**
 * import-13f.ts
 *
 * Fetches SEC EDGAR 13F-HR filings for the three tribe filers and upserts
 * Entity / ExtSource / Holding rows into the database.
 *
 * Usage:
 *   npx tsx scripts/import-13f.ts [--filer buffett|lilu|duan] [--quarters 4]
 *
 * Defaults: all filers, last 4 quarters.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { XMLParser } from "fast-xml-parser";

const db = new PrismaClient();

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

async function seedEntityCache() {
  const companies = await db.entity.findMany({
    where: { type: "company" },
    select: { id: true, metadata: true },
  });
  for (const e of companies) {
    const meta = e.metadata as Record<string, unknown> | null;
    if (meta?.cusip && typeof meta.cusip === "string") {
      entityCache.set(meta.cusip, e.id);
    }
  }
  console.log(`  Entity cache seeded: ${entityCache.size} companies`);
}

async function upsertFilerEntity(filer: (typeof FILERS)[number]) {
  return db.entity.upsert({
    where: { cik: filer.cik },
    create: {
      type: "person",
      canonicalName: filer.name,
      cik: filer.cik,
      tribeId: filer.tribeId,
    },
    update: { tribeId: filer.tribeId, canonicalName: filer.name },
  });
}

async function upsertSecurityEntity(entry: InfoTableEntry): Promise<string> {
  const cached = entityCache.get(entry.cusip);
  if (cached) return cached;

  // Not in cache — create and cache
  const created = await db.entity.create({
    data: {
      type: "company",
      canonicalName: entry.nameOfIssuer,
      ticker: null,
      metadata: { cusip: entry.cusip, titleOfClass: entry.titleOfClass },
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
  return created.id;
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
        asOfDate,
        shares: entry.shares,
        valueUsd: entry.value,
        percentOfPortfolio,
      },
      update: {
        sourceId: extSource.id,
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
  const filerArg = args.find((_, i) => args[i - 1] === "--filer");
  const quartersArg = args.find((_, i) => args[i - 1] === "--quarters");
  const maxQuarters = quartersArg ? parseInt(quartersArg, 10) : 4;

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

    const filings = await getFilings(filer.cik, maxQuarters);
    console.log(`  Found ${filings.length} 13F filings`);

    for (const filing of filings) {
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
