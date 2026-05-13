/**
 * backfill-security-table.ts
 *
 * Populate new Security table from legacy Entity(type='security')
 * and backfill Holding.securityId by securityEntityId -> Security.id.
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/backfill-security-table.ts --dry-run
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/backfill-security-table.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

function asObj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v as Record<string, unknown>;
}

async function main() {
  const entities = await db.entity.findMany({
    where: { type: "security" },
    select: { id: true, ticker: true, canonicalName: true, metadata: true },
    orderBy: { ticker: "asc" },
  });

  let upserted = 0;
  for (const e of entities) {
    const meta = asObj(e.metadata);
    const companyEntityId =
      typeof meta.companyEntityId === "string" ? meta.companyEntityId : null;
    const cusip = typeof meta.cusip === "string" ? meta.cusip : null;
    const titleOfClass = typeof meta.titleOfClass === "string" ? meta.titleOfClass : null;

    if (!dryRun) {
      // Keep progress visible in long-running backfills.
      if (upserted % 20 === 0) {
        console.log(`[backfill-security-table] upserting ${upserted + 1}/${entities.length}`);
      }
      await db.security.upsert({
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
      });
    }
    upserted++;
  }

  const securityRows = await db.security.findMany({
    select: { id: true, entityId: true },
  });
  const secByEntity = new Map(securityRows.map((s) => [s.entityId, s.id] as const));

  let holdingLinked = 0;
  if (!dryRun) {
    const holdings = await db.holding.findMany({
      where: { securityId: null },
      select: { id: true, securityEntityId: true },
    });
    for (const h of holdings) {
      const sid = secByEntity.get(h.securityEntityId);
      if (!sid) continue;
      await db.holding.update({
        where: { id: h.id },
        data: { securityId: sid },
      });
      holdingLinked++;
    }
  } else {
    const holdings = await db.holding.findMany({
      where: { securityId: null },
      select: { securityEntityId: true },
    });
    holdingLinked = holdings.filter((h) => secByEntity.has(h.securityEntityId)).length;
  }

  const totalSecurityRows = await db.security.count();
  const totalHoldings = await db.holding.count();
  const holdingWithSecurityId = await db.holding.count({ where: { securityId: { not: null } } });

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "live",
        securityEntities: entities.length,
        securityUpserted: upserted,
        holdingLinked,
        totalSecurityRows,
        holdingCoverage: {
          total: totalHoldings,
          linked: holdingWithSecurityId,
          unlinked: totalHoldings - holdingWithSecurityId,
        },
      },
      null,
      2,
    ),
  );

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[backfill-security-table] fatal", err);
  await db.$disconnect();
  process.exit(1);
});
