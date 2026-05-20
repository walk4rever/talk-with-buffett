import db from "@/lib/prisma";
import { formatUsdInYi } from "@/lib/currency";

export type QuarterPoint = {
  year: number;
  quarter: number;
};

function logDbFallback(scope: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  // Keep DB fallback silent by default to avoid noisy runtime console errors in UI/dev overlay.
  if (process.env.DEBUG_DB_FALLBACK === "1") {
    console.warn(`[master-data:${scope}] DB query failed, fallback to empty result: ${message}`);
  }
}

export async function getAvailableQuarters(tribeId: string): Promise<QuarterPoint[]> {
  try {
    const sources = await db.extSource.findMany({
      where: { filer: { is: { tribeId } }, kind: "13f" },
      select: { periodYear: true, periodQuarter: true },
      orderBy: [{ periodYear: "desc" }, { periodQuarter: "desc" }],
    });

    return sources
      .filter((s) => s.periodYear != null && s.periodQuarter != null)
      .map((s) => ({ year: s.periodYear!, quarter: s.periodQuarter! }));
  } catch (err) {
    logDbFallback("getAvailableQuarters", err);
    return [];
  }
}

export async function getHoldingsByQuarter(tribeId: string, year: number, quarter: number) {
  try {
    const rows = await db.holding.findMany({
      where: {
        holder: { tribeId },
        source: { is: { periodYear: year, periodQuarter: quarter, kind: "13f" } },
      },
      include: {
        security: true,
        securityProfile: {
          include: {
            entity: true,
            company: true,
          },
        },
      },
      orderBy: { percentOfPortfolio: "desc" },
    });
    const normalized = rows.map((row) => {
      const securityEntity = row.securityProfile?.entity ?? row.security;
      return {
        ...row,
        security: securityEntity,
      };
    });

    // Defensive dedupe: historical imports may contain duplicates that share the same security profile.
    const deduped = new Map<string, typeof normalized[number]>();
    for (const row of normalized) {
      const key = row.securityId ?? row.securityEntityId;
      const prev = deduped.get(key);
      if (!prev) {
        deduped.set(key, row);
        continue;
      }
      const prevValue = prev.valueUsd ?? BigInt(0);
      const currValue = row.valueUsd ?? BigInt(0);
      if (currValue >= prevValue) deduped.set(key, row);
    }
    return [...deduped.values()];
  } catch (err) {
    logDbFallback("getHoldingsByQuarter", err);
    return [];
  }
}

export async function getLatestHoldings(tribeId: string, limit = 10) {
  const quarters = await getAvailableQuarters(tribeId);
  if (!quarters.length) {
    return { latest: null, holdings: [] as Awaited<ReturnType<typeof getHoldingsByQuarter>> };
  }

  const latest = quarters[0];
  const holdings = await getHoldingsByQuarter(tribeId, latest.year, latest.quarter);
  return { latest, holdings: holdings.slice(0, limit) };
}

export async function getLetterYearsByType() {
  try {
    const rows = await db.source.findMany({
      select: { year: true, type: true },
      orderBy: [{ year: "desc" }, { type: "asc" }],
    });

    const byType = new Map<string, Set<number>>();
    for (const row of rows) {
      if (!byType.has(row.type)) byType.set(row.type, new Set());
      byType.get(row.type)!.add(row.year);
    }

    return byType;
  } catch (err) {
    logDbFallback("getLetterYearsByType", err);
    return new Map<string, Set<number>>();
  }
}

export async function getLetterListForPerson(personId: string) {
  if (personId !== "buffett") return [];

  const byType = await getLetterYearsByType();
  const labelByType: Record<string, string> = {
    shareholder: "致股东信",
    partnership: "合伙人信",
    annual_meeting: "股东大会",
  };

  const validTypes = ["shareholder", "partnership", "annual_meeting"];
  const list: Array<{ type: string; typeLabel: string; year: number; href: string }> = [];

  for (const type of validTypes) {
    const years = Array.from(byType.get(type) ?? []).sort((a, b) => b - a);
    for (const year of years) {
      list.push({
        type,
        typeLabel: labelByType[type] ?? type,
        year,
        href: `/letters/${type}/${year}`,
      });
    }
  }

  return list.sort((a, b) => b.year - a.year);
}

export type MasterClassItem = {
  key: string;
  label: string;
  count: number;
  range: string;
  latest: number | null;
  href: string;
};

export async function getMasterClassSummary(personId: string): Promise<MasterClassItem[]> {
  const presets: Record<string, Array<{ key: string; label: string; href: string; sourceType?: string }>> = {
    buffett: [
      { key: "shareholder", label: "致股东信", href: `/master/${personId}/library?type=shareholder`, sourceType: "shareholder" },
      { key: "partnership", label: "合伙人信", href: `/master/${personId}/library?type=partnership`, sourceType: "partnership" },
      { key: "annual_meeting", label: "股东大会", href: `/master/${personId}/library?type=annual_meeting`, sourceType: "annual_meeting" },
      { key: "article", label: "文章（建设中）", href: `/master/${personId}`, sourceType: undefined },
      { key: "video", label: "视频（建设中）", href: `/master/${personId}`, sourceType: undefined },
    ],
    lilu: [
      { key: "speech", label: "演讲（建设中）", href: `/master/${personId}` },
      { key: "article", label: "文章（建设中）", href: `/master/${personId}` },
      { key: "video", label: "视频（建设中）", href: `/master/${personId}` },
    ],
    duan: [
      { key: "post", label: "公开言论（建设中）", href: `/master/${personId}` },
      { key: "article", label: "文章（建设中）", href: `/master/${personId}` },
      { key: "video", label: "视频（建设中）", href: `/master/${personId}` },
    ],
  };

  const config = presets[personId] ?? presets.buffett;
  if (personId !== "buffett") {
    return config.map((c) => ({
      key: c.key,
      label: c.label,
      count: 0,
      range: "—",
      latest: null,
      href: c.href,
    }));
  }

  const byType = await getLetterYearsByType();
  return config.map((c) => {
    if (!c.sourceType) {
      return { key: c.key, label: c.label, count: 0, range: "—", latest: null, href: c.href };
    }
    const years = Array.from(byType.get(c.sourceType) ?? []).sort((a, b) => a - b);
    const count = years.length;
    const latest = count ? years[count - 1] : null;
    const range = count ? `${years[0]}-${years[count - 1]}` : "—";
    return { key: c.key, label: c.label, count, range, latest, href: c.href };
  });
}

type HoldingRow = Awaited<ReturnType<typeof getHoldingsByQuarter>>[number];

export type HoldingChangeSet = {
  latest: QuarterPoint | null;
  base: QuarterPoint | null;
  top: HoldingRow[];
  adds: Array<{ row: HoldingRow; delta: number }>;
  trims: Array<{ row: HoldingRow; delta: number }>;
  newPositions: HoldingRow[];
  exits: Array<{ securityEntityId: string; ticker: string | null; name: string; prevPct: number }>;
};

export async function getLatestHoldingChangeSet(tribeId: string): Promise<HoldingChangeSet> {
  const quarters = await getAvailableQuarters(tribeId);
  if (!quarters.length) {
    return {
      latest: null,
      base: null,
      top: [],
      adds: [],
      trims: [],
      newPositions: [],
      exits: [],
    };
  }

  const latest = quarters[0];
  const base = quarters[1] ?? null;
  const latestRows = await getHoldingsByQuarter(tribeId, latest.year, latest.quarter);
  const baseRows = base ? await getHoldingsByQuarter(tribeId, base.year, base.quarter) : [];

  const top = latestRows.slice(0, 10);
  const keyOf = (r: HoldingRow) => r.securityId ?? r.securityEntityId;
  const baseById = new Map(baseRows.map((r) => [keyOf(r), r] as const));
  const latestById = new Map(latestRows.map((r) => [keyOf(r), r] as const));

  const adds: Array<{ row: HoldingRow; delta: number }> = [];
  const trims: Array<{ row: HoldingRow; delta: number }> = [];
  const newPositions: HoldingRow[] = [];
  for (const row of latestRows) {
    const prev = baseById.get(keyOf(row));
    const nowPct = row.percentOfPortfolio ?? 0;
    const prevPct = prev?.percentOfPortfolio ?? 0;
    const delta = nowPct - prevPct;

    if (!prev) {
      newPositions.push(row);
      continue;
    }
    if (delta > 0.08) adds.push({ row, delta });
    if (delta < -0.08) trims.push({ row, delta });
  }

  const exits = baseRows
    .filter((r) => !latestById.has(keyOf(r)))
    .map((r) => ({
      securityEntityId: r.securityEntityId,
      ticker: r.security.ticker,
      name: r.security.canonicalName,
      prevPct: r.percentOfPortfolio ?? 0,
    }))
    .sort((a, b) => b.prevPct - a.prevPct);

  adds.sort((a, b) => b.delta - a.delta);
  trims.sort((a, b) => a.delta - b.delta);
  newPositions.sort((a, b) => (b.percentOfPortfolio ?? 0) - (a.percentOfPortfolio ?? 0));

  return {
    latest,
    base,
    top,
    adds: adds.slice(0, 5),
    trims: trims.slice(0, 5),
    newPositions: newPositions.slice(0, 5),
    exits: exits.slice(0, 5),
  };
}

export function buildHoldingInsights(changeSet: HoldingChangeSet): string[] {
  if (!changeSet.latest || !changeSet.top.length) return [];
  const top5 = changeSet.top.slice(0, 5).reduce((sum, h) => sum + (h.percentOfPortfolio ?? 0), 0);
  const insights = [
    `前五大持仓合计 ${top5.toFixed(2)}%，组合集中度${top5 >= 60 ? "较高" : "中等"}.`,
  ];
  if (changeSet.newPositions.length) {
    const first = changeSet.newPositions[0];
    insights.push(`本季新进 ${changeSet.newPositions.length} 个标的，最大新进为 ${first.security.ticker ?? first.security.canonicalName}.`);
  }
  if (changeSet.adds.length) {
    const first = changeSet.adds[0];
    insights.push(`增持幅度最大：${first.row.security.ticker ?? first.row.security.canonicalName}（+${first.delta.toFixed(2)}pp）.`);
  }
  if (changeSet.trims.length || changeSet.exits.length) {
    const trimText = changeSet.trims[0]
      ? `${changeSet.trims[0].row.security.ticker ?? changeSet.trims[0].row.security.canonicalName}（${changeSet.trims[0].delta.toFixed(2)}pp）`
      : null;
    const exitText = changeSet.exits[0]
      ? `${changeSet.exits[0].ticker ?? changeSet.exits[0].name}`
      : null;
    insights.push(`减持/退出信号：${[trimText, exitText].filter(Boolean).join("，")}。`);
  }
  return insights.slice(0, 4);
}

export function formatValueUsd(valueUsd: bigint | null): string {
  return formatUsdInYi(valueUsd);
}

export function formatShares(shares: bigint | null): string {
  if (shares == null) return "—";
  const n = Number(shares);
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toLocaleString();
}
