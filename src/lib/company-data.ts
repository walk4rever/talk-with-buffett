import db from "@/lib/prisma";

export async function getCompanyByTicker(ticker: string) {
  return db.entity.findFirst({
    where: {
      type: "company",
      ticker: {
        equals: ticker.toUpperCase(),
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      canonicalName: true,
      ticker: true,
      cik: true,
      sector: true,
      metadata: true,
    },
  });
}

export async function getCompanyFinancials(entityId: string, limit = 8) {
  const rows = await db.financial.findMany({
    where: { entityId, periodType: "FY" },
    orderBy: [{ periodEnd: "desc" }, { lineItem: "asc" }],
    select: {
      id: true,
      periodEnd: true,
      lineItem: true,
      value: true,
      unit: true,
    },
    take: 400,
  });

  const byYear = new Map<number, Record<string, string>>();
  for (const row of rows) {
    const year = row.periodEnd.getUTCFullYear();
    if (!byYear.has(year)) byYear.set(year, {});
    const bucket = byYear.get(year)!;
    if (!(row.lineItem in bucket) && row.value != null) {
      bucket[row.lineItem] = row.value.toString();
    }
  }

  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, limit)
    .map(([year, items]) => ({ year, items }));
}

export async function getRecentHolders(entityId: string, limit = 20) {
  const latest = await db.holding.findFirst({
    where: { securityEntityId: entityId },
    orderBy: { asOfDate: "desc" },
    select: { asOfDate: true },
  });
  if (!latest) return { asOfDate: null, holders: [] as Array<{ id: string; name: string; tribeId: string | null; percent: number | null; valueUsd: bigint | null; sourceYear: number | null; sourceQuarter: number | null }> };

  const holders = await db.holding.findMany({
    where: {
      securityEntityId: entityId,
      asOfDate: latest.asOfDate,
    },
    orderBy: { valueUsd: "desc" },
    include: {
      holder: { select: { id: true, canonicalName: true, tribeId: true } },
      source: { select: { periodYear: true, periodQuarter: true } },
    },
    take: limit,
  });

  return {
    asOfDate: latest.asOfDate,
    holders: holders.map((h) => ({
      id: h.holder.id,
      name: h.holder.canonicalName,
      tribeId: h.holder.tribeId,
      percent: h.percentOfPortfolio,
      valueUsd: h.valueUsd,
      sourceYear: h.source.periodYear,
      sourceQuarter: h.source.periodQuarter,
    })),
  };
}

export function formatMoney(v: string | bigint | null) {
  if (v == null) return "—";
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
}
