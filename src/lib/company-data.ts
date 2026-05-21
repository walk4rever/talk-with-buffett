import db from "@/lib/prisma";
import { formatUsdInYi } from "@/lib/currency";
import { computeHoldingActivity, computeShareDeltaPct } from "@/lib/holding-activity";
import { normalizeTicker } from "@/lib/ticker";
import { Prisma } from "@prisma/client";

export async function getCompanyByCik(cikRaw: string) {
  const cik = String(Number(cikRaw.replace(/\D/g, "")));
  if (!cik || cik === "0" || Number.isNaN(Number(cik))) return null;

  const entity = await db.entity.findUnique({
    where: { cik },
    select: {
      id: true,
      type: true,
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
  const normalizedTicker = normalizeTicker(ticker);
  if (!normalizedTicker) return null;
  const rows = await db.entity.findMany({
    where: {
      type: { in: ["company", "master"] },
      ticker: {
        equals: normalizedTicker,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      type: true,
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
      (x.type === "master" ? 120 : 0) +
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

export async function getCompanySecurities(entityId: string) {
  const rows = await db.security.findMany({
    where: { companyEntityId: entityId },
    select: {
      id: true,
      ticker: true,
      shareClass: true,
      titleOfClass: true,
      exchange: true,
      isPrimary: true,
    },
    orderBy: [{ isPrimary: "desc" }, { ticker: "asc" }],
  });

  return rows;
}

async function getEntityFamilyIds(entityId: string) {
  const base = await db.entity.findUnique({
    where: { id: entityId },
    select: { id: true, ticker: true, type: true, cik: true },
  });
  if (!base) return [entityId];
  if (!base.ticker) return [entityId];

  const siblings = await db.entity.findMany({
    where: {
      type: { in: ["company", "master"] },
      ticker: {
        equals: normalizeTicker(base.ticker) ?? base.ticker,
        mode: "insensitive",
      },
    },
    select: { id: true, type: true, cik: true },
  });

  if (!siblings.length) return [entityId];
  return siblings
    .sort((a, b) => {
      const score = (x: (typeof siblings)[number]) =>
        (x.type === "master" ? 120 : 0) + (x.cik ? 100 : 0);
      return score(b) - score(a);
    })
    .map((s) => s.id);
}

async function getSecurityIdsForCompany(entityId: string) {
  const base = await db.entity.findUnique({
    where: { id: entityId },
    select: { id: true, ticker: true, canonicalName: true },
  });
  if (!base) return { profileIds: [] as string[], legacyEntityIds: [entityId] };

  const familyCompanyIds = await getEntityFamilyIds(entityId);
  const ticker = normalizeTicker(base.ticker);

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
  const rows = await db.holding.findMany({
    where: {
      OR: [
        { securityId: { in: securityScope.profileIds } },
        { securityEntityId: { in: securityScope.legacyEntityIds } },
      ],
    },
    orderBy: [
      { holderEntityId: "asc" },
      { asOfDate: "desc" },
      { valueUsd: "desc" },
    ],
    include: {
      holder: { select: { id: true, canonicalName: true, tribeId: true } },
      source: { select: { periodYear: true, periodQuarter: true } },
    },
    take: 500,
  });
  if (!rows.length) {
    return {
      asOfDate: null,
      holders: [] as Array<{
        id: string;
        name: string;
        tribeId: string | null;
        percent: number | null;
        valueUsd: bigint | null;
        shares: bigint | null;
        sourceYear: number | null;
        sourceQuarter: number | null;
        asOfDate: Date | null;
        activity: "New" | "Added" | "Reduced" | "Unchanged";
        shareDeltaPct: number | null;
      }>,
    };
  }

  type Row = (typeof rows)[number];
  type HolderState = {
    id: string;
    name: string;
    tribeId: string | null;
    current: {
      asOfDate: Date | null;
      percent: number | null;
      valueUsd: bigint | null;
      shares: bigint | null;
      sourceYear: number | null;
      sourceQuarter: number | null;
    };
    previous: {
      asOfDate: Date | null;
      percent: number | null;
      valueUsd: bigint | null;
      shares: bigint | null;
      sourceYear: number | null;
      sourceQuarter: number | null;
    } | null;
  };

  const byHolder = new Map<string, HolderState>();

  const addToBucket = (
    bucket: {
      asOfDate: Date | null;
      percent: number | null;
      valueUsd: bigint | null;
      shares: bigint | null;
      sourceYear: number | null;
      sourceQuarter: number | null;
    },
    row: Row,
  ) => {
    bucket.percent = (bucket.percent ?? 0) + (row.percentOfPortfolio ?? 0);
    bucket.valueUsd = (bucket.valueUsd ?? BigInt(0)) + (row.valueUsd ?? BigInt(0));
    bucket.shares = (bucket.shares ?? BigInt(0)) + (row.shares ?? BigInt(0));
    bucket.sourceYear = row.source.periodYear ?? bucket.sourceYear;
    bucket.sourceQuarter = row.source.periodQuarter ?? bucket.sourceQuarter;
  };

  for (const row of rows) {
    const key = row.holder.id;
    const state = byHolder.get(key);
    if (!state) {
      byHolder.set(key, {
        id: row.holder.id,
        name: row.holder.canonicalName,
        tribeId: row.holder.tribeId,
        current: {
          asOfDate: row.asOfDate,
          percent: row.percentOfPortfolio,
          valueUsd: row.valueUsd,
          shares: row.shares,
          sourceYear: row.source.periodYear,
          sourceQuarter: row.source.periodQuarter,
        },
        previous: null,
      });
      continue;
    }

    const currentTime = state.current.asOfDate?.getTime() ?? 0;
    const currentRowTime = row.asOfDate.getTime();
    const previousTime = state.previous?.asOfDate?.getTime() ?? null;

    if (currentRowTime === currentTime) {
      addToBucket(state.current, row);
      continue;
    }

    if (previousTime == null) {
      state.previous = {
        asOfDate: row.asOfDate,
        percent: row.percentOfPortfolio,
        valueUsd: row.valueUsd,
        shares: row.shares,
        sourceYear: row.source.periodYear,
        sourceQuarter: row.source.periodQuarter,
      };
      continue;
    }

    if (currentRowTime === previousTime && state.previous) {
      addToBucket(state.previous, row);
    }
  }

  const holders = [...byHolder.values()]
    .map((state) => {
      const shareDeltaPct = computeShareDeltaPct(state.previous?.shares, state.current.shares);
      const activity = state.previous
        ? computeHoldingActivity(true, true, shareDeltaPct)
        : "New";
      return {
        id: state.id,
        name: state.name,
        tribeId: state.tribeId,
        percent: state.current.percent,
        valueUsd: state.current.valueUsd,
        shares: state.current.shares,
        sourceYear: state.current.sourceYear,
        sourceQuarter: state.current.sourceQuarter,
        asOfDate: state.current.asOfDate,
        activity,
        shareDeltaPct,
      };
    })
    .sort((a, b) => Number(b.valueUsd ?? BigInt(0)) - Number(a.valueUsd ?? BigInt(0)))
    .slice(0, limit);

  return {
    asOfDate: null,
    holders,
  };
}

export function formatMoney(v: string | bigint | null) {
  return formatUsdInYi(v);
}

export async function getCompanyAnalysis(entityId: string) {
  const row = await db.companyAnalysis.findUnique({
    where: { entityId },
    select: { narrative: true, moat: true, source: true, version: true },
  });
  return row ?? null;
}
