/**
 * backfill-names.ts
 *
 * Patches existing security entities in the DB:
 *   - Sets ticker from resolveTickerFromName when currently null
 *   - Overwrites stale/English nameZh with resolved Chinese name
 *   - Updates nameEnShort with current normalizeEnglishName output
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx scripts/backfill-names.ts
 *   npx dotenv -e .env.local -- npx tsx scripts/backfill-names.ts --dry-run
 */
import { PrismaClient } from "@prisma/client";
import {
  normalizeEnglishName,
  resolveZhFromName,
  resolveTickerFromName,
} from "../src/lib/company-name-map";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(`[backfill-names] mode=${dryRun ? "dry-run" : "live"}`);

  const entities = await db.entity.findMany({
    where: { type: "company" },
    select: { id: true, canonicalName: true, ticker: true, metadata: true },
  });

  console.log(`[backfill-names] found ${entities.length} company entities`);

  let updated = 0;
  let skipped = 0;

  for (const entity of entities) {
    const meta = (entity.metadata as Record<string, unknown> | null) ?? {};
    const existingNameZh = typeof meta.nameZh === "string" ? meta.nameZh : null;

    const resolvedZh = resolveZhFromName(entity.canonicalName);
    const resolvedTicker = resolveTickerFromName(entity.canonicalName);
    const resolvedEnShort = normalizeEnglishName(entity.canonicalName);

    // Determine what needs updating
    const needsZh = resolvedZh !== null && resolvedZh !== existingNameZh;
    const needsTicker = resolvedTicker !== null && entity.ticker !== resolvedTicker;
    const needsEnShort = resolvedEnShort !== meta.nameEnShort;

    if (!needsZh && !needsTicker && !needsEnShort) {
      skipped++;
      continue;
    }

    const newZh = resolvedZh ?? existingNameZh ?? resolvedEnShort;
    const changes: string[] = [];
    if (needsZh) changes.push(`nameZh: "${existingNameZh ?? "(none)"}" → "${newZh}"`);
    if (needsTicker) changes.push(`ticker: "${entity.ticker ?? "null"}" → "${resolvedTicker}"`);
    if (needsEnShort) changes.push(`nameEnShort: "${meta.nameEnShort ?? "(none)"}" → "${resolvedEnShort}"`);

    console.log(`[backfill-names] ${entity.canonicalName} | ${changes.join(" | ")}`);

    if (!dryRun) {
      await db.entity.update({
        where: { id: entity.id },
        data: {
          ticker: needsTicker ? resolvedTicker : entity.ticker,
          metadata: {
            ...meta,
            nameZh: newZh,
            nameEnShort: resolvedEnShort,
          },
        },
      });
    }
    updated++;
  }

  console.log(`\n[backfill-names] done — updated=${dryRun ? `${updated} (dry-run)` : updated} skipped=${skipped}`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error("[backfill-names] fatal", err);
  process.exit(1);
});
