import db from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export async function getCompanyByCik(cikRaw: string) {
  const cik = String(Number(cikRaw.replace(/\D/g, "")));
  if (!cik || cik === "0" || Number.isNaN(Number(cik))) return null;

  const entity = await db.entity.findUnique({
    where: { cik },
    select: {
      id: true,
      canonicalName: true,
      ticker: true,
      cik: true,
      sector: true,
      metadata: true,
    },
  });
  return entity;
}

export async function getCompanyByTicker(ticker: string) {
  const normalizedTicker = ticker.toUpperCase();
  const rows = await db.entity.findMany({
    where: {
      type: "company",
      ticker: {
        equals: normalizedTicker,
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
      updatedAt: true,
      _count: {
        select: {
          financials: true,
          holdingsAsSecurity: true,
        },
      },
    },
  });

  if (rows.length === 0) {
    // Fallback: resolve via security ticker (e.g. GOOG/GOOGL share classes).
    const security = await db.security.findFirst({
      where: { ticker: { equals: normalizedTicker, mode: "insensitive" } },
      select: { companyEntityId: true, entityId: true },
      orderBy: { updatedAt: "desc" },
    });

    const fallbackCompanyId = security?.companyEntityId;
    if (!fallbackCompanyId) return null;

    const resolved = await db.entity.findUnique({
      where: { id: fallbackCompanyId },
      select: {
        id: true,
        canonicalName: true,
        ticker: true,
        cik: true,
        sector: true,
        metadata: true,
      },
    });
    if (!resolved) return null;
    return resolved;
  }

  const best = [...rows].sort((a, b) => {
    const score = (x: (typeof rows)[number]) =>
      (x.cik ? 100 : 0) +
      (x._count.financials > 0 ? 50 : 0) +
      (x._count.holdingsAsSecurity > 0 ? 30 : 0);
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  })[0];

  return {
    id: best.id,
    canonicalName: best.canonicalName,
    ticker: best.ticker,
    cik: best.cik,
    sector: best.sector,
    metadata: best.metadata,
  };
}

export async function getCompanyByIdentifier(identifier: string) {
  const byCik = await getCompanyByCik(identifier);
  if (byCik) return byCik;
  return getCompanyByTicker(identifier);
}

async function getEntityFamilyIds(entityId: string) {
  const base = await db.entity.findUnique({
    where: { id: entityId },
    select: { id: true, ticker: true },
  });
  if (!base) return [entityId];
  if (!base.ticker) return [entityId];

  const siblings = await db.entity.findMany({
    where: {
      type: "company",
      ticker: {
        equals: base.ticker,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });

  if (!siblings.length) return [entityId];
  return siblings.map((s) => s.id);
}

async function getSecurityIdsForCompany(entityId: string) {
  const base = await db.entity.findUnique({
    where: { id: entityId },
    select: { id: true, ticker: true, canonicalName: true },
  });
  if (!base) return { profileIds: [] as string[], legacyEntityIds: [entityId] };

  const familyCompanyIds = await getEntityFamilyIds(entityId);
  const ticker = base.ticker?.toUpperCase() ?? null;

  const securityProfiles = await db.security.findMany({
    where: {
      OR: [
        { companyEntityId: entityId },
        ...(familyCompanyIds.length > 1
          ? familyCompanyIds.map((id) => ({ companyEntityId: id }))
          : []),
        ...(ticker
          ? [
            {
              ticker: { equals: ticker, mode: Prisma.QueryMode.insensitive },
            },
          ]
          : []),
      ],
    },
    select: { id: true, entityId: true },
  });

  const profileIds = new Set<string>();
  const legacyEntityIds = new Set<string>(familyCompanyIds);
  for (const s of securityProfiles) {
    profileIds.add(s.id);
    legacyEntityIds.add(s.entityId);
  }
  return {
    profileIds: [...profileIds],
    legacyEntityIds: [...legacyEntityIds],
  };
}

export async function getCompanyFinancials(entityId: string, limit = 8) {
  const familyIds = await getEntityFamilyIds(entityId);
  const rows = await db.financial.findMany({
    where: { entityId: { in: familyIds }, periodType: "FY" },
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
  const securityScope = await getSecurityIdsForCompany(entityId);
  const latest = await db.holding.findFirst({
    where: {
      OR: [
        { securityId: { in: securityScope.profileIds } },
        { securityEntityId: { in: securityScope.legacyEntityIds } },
      ],
    },
    orderBy: { asOfDate: "desc" },
    select: { asOfDate: true },
  });
  if (!latest) return { asOfDate: null, holders: [] as Array<{ id: string; name: string; tribeId: string | null; percent: number | null; valueUsd: bigint | null; sourceYear: number | null; sourceQuarter: number | null }> };

  const rows = await db.holding.findMany({
    where: {
      OR: [
        { securityId: { in: securityScope.profileIds } },
        { securityEntityId: { in: securityScope.legacyEntityIds } },
      ],
      asOfDate: latest.asOfDate,
    },
    orderBy: { valueUsd: "desc" },
    include: {
      holder: { select: { id: true, canonicalName: true, tribeId: true } },
      source: { select: { periodYear: true, periodQuarter: true } },
    },
    take: limit,
  });

  const byHolder = new Map<string, {
    id: string;
    name: string;
    tribeId: string | null;
    percent: number | null;
    valueUsd: bigint | null;
    sourceYear: number | null;
    sourceQuarter: number | null;
  }>();

  for (const h of rows) {
    const prev = byHolder.get(h.holder.id);
    if (!prev) {
      byHolder.set(h.holder.id, {
        id: h.holder.id,
        name: h.holder.canonicalName,
        tribeId: h.holder.tribeId,
        percent: h.percentOfPortfolio,
        valueUsd: h.valueUsd,
        sourceYear: h.source.periodYear,
        sourceQuarter: h.source.periodQuarter,
      });
      continue;
    }
    byHolder.set(h.holder.id, {
      ...prev,
      percent: h.percentOfPortfolio ?? prev.percent,
      valueUsd: (prev.valueUsd ?? BigInt(0)) + (h.valueUsd ?? BigInt(0)),
      sourceYear: h.source.periodYear ?? prev.sourceYear,
      sourceQuarter: h.source.periodQuarter ?? prev.sourceQuarter,
    });
  }

  const holders = [...byHolder.values()]
    .sort((a, b) => Number(b.valueUsd ?? BigInt(0)) - Number(a.valueUsd ?? BigInt(0)))
    .slice(0, limit);

  return {
    asOfDate: latest.asOfDate,
    holders,
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
