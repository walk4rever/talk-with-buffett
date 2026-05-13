/**
 * migrate-company-securities.ts
 *
 * Convert legacy 13F "company" rows into "security" rows.
 *
 * Rules:
 * - only convert Entity.type="company" rows where:
 *   - cik is null
 *   - metadata.cusip exists
 *   - financial count is 0
 * - preserve id so Holding.securityEntityId keeps working
 * - set metadata.companyEntityId to a best-effort parent company
 *   (prefer same-ticker company with non-null cik)
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/migrate-company-securities.ts --dry-run
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/migrate-company-securities.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

type JsonObj = Record<string, unknown>;

function asObj(v: unknown): JsonObj {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v as JsonObj;
}

async function main() {
  const companiesWithCik = await db.entity.findMany({
    where: { type: "company", cik: { not: null }, ticker: { not: null } },
    select: { id: true, ticker: true },
  });
  const companyByTicker = new Map<string, string>();
  for (const c of companiesWithCik) {
    if (c.ticker) companyByTicker.set(c.ticker.toUpperCase(), c.id);
  }

  const candidates = await db.entity.findMany({
    where: {
      type: "company",
      cik: null,
      metadata: { path: ["cusip"], not: null },
    },
    select: {
      id: true,
      canonicalName: true,
      ticker: true,
      metadata: true,
      _count: {
        select: {
          financials: true,
          holdingsAsSecurity: true,
        },
      },
    },
    orderBy: { canonicalName: "asc" },
  });

  const plan = candidates
    .filter((e) => e._count.financials === 0)
    .map((e) => {
      const meta = asObj(e.metadata);
      const existingLink =
        typeof meta.companyEntityId === "string" ? meta.companyEntityId : null;
      const mappedByTicker =
        e.ticker ? companyByTicker.get(e.ticker.toUpperCase()) ?? null : null;
      const companyEntityId = existingLink ?? mappedByTicker;
      return {
        id: e.id,
        canonicalName: e.canonicalName,
        ticker: e.ticker,
        holdings: e._count.holdingsAsSecurity,
        companyEntityId,
        metadata: meta,
      };
    });

  const withHoldings = plan.filter((x) => x.holdings > 0).length;
  const mapped = plan.filter((x) => x.companyEntityId).length;
  const unmapped = plan.length - mapped;

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "live",
        totalCandidates: plan.length,
        withHoldings,
        mappedCompanyEntityId: mapped,
        unmappedCompanyEntityId: unmapped,
        sample: plan.slice(0, 15).map((x) => ({
          id: x.id,
          canonicalName: x.canonicalName,
          ticker: x.ticker,
          holdings: x.holdings,
          companyEntityId: x.companyEntityId,
          cusip: x.metadata.cusip ?? null,
        })),
      },
      null,
      2,
    ),
  );

  if (dryRun) {
    await db.$disconnect();
    return;
  }

  let converted = 0;
  for (const row of plan) {
    const nextMeta: JsonObj = {
      ...row.metadata,
      ...(row.companyEntityId ? { companyEntityId: row.companyEntityId } : {}),
    };
    await db.entity.update({
      where: { id: row.id },
      data: {
        type: "security",
        metadata: nextMeta,
      },
    });
    converted++;
  }

  console.log(`[migrate-company-securities] converted=${converted}`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[migrate-company-securities] fatal", err);
  await db.$disconnect();
  process.exit(1);
});

