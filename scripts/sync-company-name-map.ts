/**
 * sync-company-name-map.ts
 *
 * Sync DB entities into CompanyNameMap.
 * This keeps CompanyNameMap as the single source of truth (no code dictionary).
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/sync-company-name-map.ts --dry-run
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/sync-company-name-map.ts
 */
import { PrismaClient } from "@prisma/client";
import { issuerKey } from "../src/lib/company-name-map";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const companies = await db.entity.findMany({
    where: { type: "company" },
    select: { ticker: true, canonicalName: true, metadata: true },
  });
  const tickerRows = companies
    .filter((c) => c.ticker)
    .map((c) => {
      const meta = (c.metadata as Record<string, unknown> | null) ?? {};
      const nameZh = typeof meta.nameZh === "string" ? meta.nameZh : null;
      return {
        keyType: "ticker",
        key: c.ticker!.toUpperCase(),
        nameZh,
        ticker: c.ticker!.toUpperCase(),
        source: "entity.company",
      };
    })
    .filter((r): r is { keyType: string; key: string; nameZh: string; ticker: string; source: string } => Boolean(r.nameZh));

  const issuerRows = companies.map((c) => {
    const meta = (c.metadata as Record<string, unknown> | null) ?? {};
    const nameZh = typeof meta.nameZh === "string" ? meta.nameZh : null;
    const ticker = c.ticker?.toUpperCase() ?? null;
    return {
      keyType: "issuer",
      key: issuerKey(c.canonicalName),
      nameZh,
      ticker,
      source: "entity.company",
    };
  });

  console.log(JSON.stringify({
    mode: dryRun ? "dry-run" : "live",
    tickerRows: tickerRows.length,
    issuerRows: issuerRows.length,
    total: tickerRows.length + issuerRows.length,
    sampleTicker: tickerRows.slice(0, 5),
    sampleIssuer: issuerRows.slice(0, 5),
  }, null, 2));

  if (!dryRun) {
    for (const row of tickerRows) {
      await db.companyNameMap.upsert({
        where: { keyType_key: { keyType: row.keyType, key: row.key } },
        create: row,
        update: {
          nameZh: row.nameZh,
          ticker: row.ticker,
          source: row.source,
        },
      });
    }
    for (const row of issuerRows) {
      await db.companyNameMap.upsert({
        where: { keyType_key: { keyType: row.keyType, key: row.key } },
        create: row,
        update: {
          nameZh: row.nameZh,
          ticker: row.ticker,
          source: row.source,
        },
      });
    }
    console.log("[sync-company-name-map] done");
  }

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[sync-company-name-map] fatal", err);
  await db.$disconnect();
  process.exit(1);
});
