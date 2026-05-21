import { PrismaClient, Prisma } from "@prisma/client";
import { normalizeTicker } from "../src/lib/ticker";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const tickerArg = process.argv.find((_, i, arr) => arr[i - 1] === "--ticker") ?? null;
const onlyTicker = normalizeTicker(tickerArg);

type JsonObj = Record<string, unknown>;

function asObj(v: unknown): JsonObj {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v as JsonObj;
}

function entityScore(input: {
  type: string;
  cik: string | null;
  tribeId: string | null;
  financialCount: number;
}) {
  return (
    (input.type === "master" ? 120 : 0) +
    (input.cik ? 100 : 0) +
    (input.tribeId ? 40 : 0) +
    input.financialCount
  );
}

async function buildPlan() {
  const entities = await db.entity.findMany({
    where: {
      type: { in: ["company", "master"] },
      ticker: { not: null },
    },
    select: {
      id: true,
      type: true,
      ticker: true,
      cik: true,
      tribeId: true,
      canonicalName: true,
      metadata: true,
      _count: {
        select: {
          financials: true,
          mentions: true,
          analyses: true,
          relationsAsSrc: true,
          relationsAsDst: true,
        },
      },
    },
    orderBy: [{ ticker: "asc" }, { type: "asc" }],
  });

  const byTicker = new Map<string, typeof entities>();
  for (const entity of entities) {
    const ticker = normalizeTicker(entity.ticker);
    if (!ticker) continue;
    if (onlyTicker && ticker !== onlyTicker) continue;
    const list = byTicker.get(ticker) ?? [];
    list.push(entity);
    byTicker.set(ticker, list);
  }

  const plan: Array<{
    ticker: string;
    keep: string;
    drop: string;
    keepName: string;
    dropName: string;
    duplicateFinancialIds: string[];
    duplicateSourceIds: string[];
    updateSecurityMetaIds: string[];
    blockers: string[];
  }> = [];

  for (const [ticker, list] of byTicker.entries()) {
    if (list.length < 2) continue;
    const ranked = [...list].sort((a, b) =>
      entityScore({
        type: b.type,
        cik: b.cik,
        tribeId: b.tribeId,
        financialCount: b._count.financials,
      }) -
      entityScore({
        type: a.type,
        cik: a.cik,
        tribeId: a.tribeId,
        financialCount: a._count.financials,
      }),
    );

    const keep = ranked[0];
    for (const drop of ranked.slice(1)) {
      const blockers: string[] = [];
      const securityLinks = await db.security.findMany({
        where: {
          OR: [
            { companyEntityId: drop.id },
            { metadata: { path: ["companyEntityId"], equals: drop.id } },
          ],
        },
        select: { id: true, metadata: true },
      });
      const holdingCount = await db.holding.count({ where: { securityEntityId: drop.id } });
      const extSources = await db.extSource.findMany({
        where: { filerEntityId: drop.id },
        select: {
          id: true,
          kind: true,
          periodYear: true,
          periodQuarter: true,
          filedAt: true,
          holdings: { select: { id: true } },
          financials: {
            select: { id: true, periodEnd: true, periodType: true, lineItem: true },
          },
        },
      });
      const financials = await db.financial.findMany({
        where: { entityId: drop.id },
        select: { id: true, periodEnd: true, periodType: true, lineItem: true, sourceId: true },
      });

      if (holdingCount > 0) blockers.push(`holding.securityEntityId refs=${holdingCount}`);
      if (drop._count.mentions > 0) blockers.push(`mentions=${drop._count.mentions}`);
      if (drop._count.analyses > 0) blockers.push(`analyses=${drop._count.analyses}`);
      if (drop._count.relationsAsSrc > 0 || drop._count.relationsAsDst > 0) {
        blockers.push(`relations=${drop._count.relationsAsSrc + drop._count.relationsAsDst}`);
      }

      const updateSecurityMetaIds: string[] = [];
      for (const sec of securityLinks) {
        const meta = asObj(sec.metadata);
        if (meta.companyEntityId === drop.id) updateSecurityMetaIds.push(sec.id);
      }
      const directCompanyLinks = securityLinks.filter((s) => !updateSecurityMetaIds.includes(s.id));
      if (directCompanyLinks.length > 0) blockers.push(`security.companyEntityId refs=${directCompanyLinks.length}`);

      const duplicateFinancialIds: string[] = [];
      for (const row of financials) {
        const exists = await db.financial.findFirst({
          where: {
            entityId: keep.id,
            periodEnd: row.periodEnd,
            periodType: row.periodType,
            lineItem: row.lineItem,
          },
          select: { id: true },
        });
        if (!exists) {
          blockers.push(
            `non-duplicate financial ${row.periodEnd.toISOString().slice(0, 10)} ${row.periodType} ${row.lineItem}`,
          );
          continue;
        }
        duplicateFinancialIds.push(row.id);
      }

      const duplicateSourceIds: string[] = [];
      for (const source of extSources) {
        if (source.holdings.length > 0) {
          blockers.push(`extSource ${source.id} has holdings=${source.holdings.length}`);
          continue;
        }
        const sourceFinancialIds = source.financials.map((f) => f.id);
        const allFinancialsDup = sourceFinancialIds.every((id) => duplicateFinancialIds.includes(id));
        if (!allFinancialsDup) {
          blockers.push(`extSource ${source.id} has non-duplicate financials`);
          continue;
        }
        duplicateSourceIds.push(source.id);
      }

      plan.push({
        ticker,
        keep: keep.id,
        drop: drop.id,
        keepName: keep.canonicalName,
        dropName: drop.canonicalName,
        duplicateFinancialIds,
        duplicateSourceIds,
        updateSecurityMetaIds,
        blockers: [...new Set(blockers)],
      });
    }
  }

  return plan;
}

async function main() {
  const plan = await buildPlan();
  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "live",
        filterTicker: onlyTicker,
        candidates: plan.map((item) => ({
          ticker: item.ticker,
          keep: item.keepName,
          drop: item.dropName,
          keepId: item.keep,
          dropId: item.drop,
          duplicateFinancials: item.duplicateFinancialIds.length,
          duplicateSources: item.duplicateSourceIds.length,
          securityMetaRefsToRewrite: item.updateSecurityMetaIds.length,
          blockers: item.blockers,
        })),
      },
      null,
      2,
    ),
  );

  if (dryRun) return;

  for (const item of plan) {
    if (item.blockers.length > 0) continue;
    await db.$transaction(async (tx) => {
      if (item.updateSecurityMetaIds.length > 0) {
        const rows = await tx.security.findMany({
          where: { id: { in: item.updateSecurityMetaIds } },
          select: { id: true, metadata: true },
        });
        for (const row of rows) {
          const meta = asObj(row.metadata);
          await tx.security.update({
            where: { id: row.id },
            data: {
              metadata: {
                ...meta,
                companyEntityId: item.keep,
              } as Prisma.InputJsonValue,
            },
          });
        }
      }

      if (item.duplicateFinancialIds.length > 0) {
        await tx.financial.deleteMany({
          where: { id: { in: item.duplicateFinancialIds } },
        });
      }

      if (item.duplicateSourceIds.length > 0) {
        await tx.extSource.deleteMany({
          where: { id: { in: item.duplicateSourceIds } },
        });
      }

      await tx.entity.delete({
        where: { id: item.drop },
      });
    });
  }

  console.log("[cleanup-duplicate-company-entities] done");
}

main()
  .catch(async (err) => {
    console.error("[cleanup-duplicate-company-entities] fatal", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
