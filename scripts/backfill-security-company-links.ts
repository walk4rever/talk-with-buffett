/**
 * backfill-security-company-links.ts
 *
 * One-shot reconciliation for security/company linkage and ticker completeness.
 *
 * What it does:
 * 1) Resolve ticker via stable priority:
 *    CUSIP override > existing security ticker > existing entity ticker > issuer map
 * 2) Resolve company entity via:
 *    existing link > ticker->company > issuer->company > SEC ticker map -> create company shell
 * 3) Persist updates to BOTH security + entity(metadata/companyEntityId/ticker)
 *
 * Usage:
 *   npm run backfill:security:company-links
 *   npm run backfill:security:company-links -- --dry-run
 *   npm run backfill:security:company-links -- --strict
 */
import { PrismaClient } from "@prisma/client";
import { issuerKey, normalizeEnglishName } from "../src/lib/company-name-map";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const strict = process.argv.includes("--strict");

const SEC_WWW = "https://www.sec.gov";
const HEADERS = {
  "User-Agent": "buffett-tribe research walkklaw@gmail.com",
  Accept: "application/json, text/xml, */*",
};

const TICKER_ALIASES: Record<string, string> = {
  "BRK.B": "BRK-B",
  "BRK.A": "BRK-A",
  LLIVE: "LLYVK",
  YY: "JOYY",
};

// High-confidence CUSIP overrides for known dual-class / naming edge cases.
const CUSIP_TICKER_OVERRIDES: Record<string, string> = {
  "02079K107": "GOOG", // Alphabet Class C
  "02079K305": "GOOGL", // Alphabet Class A
  "88034P109": "TME", // Tencent Music ADR
  "G9001E102": "LILA", // Liberty Latin America Class A
  "G9001E128": "LILAK", // Liberty Latin America Class C
  "530909100": "LLYVA", // Liberty Live Series A
  "530909308": "LLYVK", // Liberty Live Series C
};

function normalizeTicker(ticker: string): string {
  const raw = ticker.trim().toUpperCase();
  return TICKER_ALIASES[raw] ?? raw;
}

function normalizeCusip(raw: string): string {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact) return "";
  if (/^\d+$/.test(compact) && compact.length < 9) return compact.padStart(9, "0");
  return compact;
}

function issuerMatchKey(name: string): string {
  const base = normalizeEnglishName(name)
    .replace(/\b(DEL|DE|NEW)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const ABBR: Record<string, string> = {
    AIRLS: "AIRLINES",
    CONTL: "CONTINENTAL",
    COMM: "COMMUNICATIONS",
    INTL: "INTERNATIONAL",
    ENTMT: "ENTERTAINMENT",
    BK: "BANK",
    MTRS: "MOTORS",
    WHSL: "WHOLESALE",
    COS: "COMPANIES",
    SYS: "SYSTEMS",
    HLDG: "HOLDING",
    HLDGS: "HOLDINGS",
  };

  const expanded = base
    .split(/\\s+/)
    .map((token) => ABBR[token.toUpperCase()] ?? token)
    .join(" ");

  return expanded.toUpperCase().replace(/[^A-Z0-9 ]/g, "");
}

function asObj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v as Record<string, unknown>;
}

async function getTickerCikMap() {
  const res = await fetch(`${SEC_WWW}/files/company_tickers.json`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Ticker map fetch failed: ${res.status}`);
  const data = (await res.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
  const map = new Map<string, { cik: string; title: string }>();
  const tickerByIssuer = new Map<string, string>();
  for (const item of Object.values(data)) {
    map.set(item.ticker.toUpperCase(), { cik: String(item.cik_str), title: item.title });
    tickerByIssuer.set(issuerMatchKey(item.title), item.ticker.toUpperCase());
  }
  return { tickerMap: map, tickerByIssuer };
}

async function main() {
  const { tickerMap, tickerByIssuer: secTickerByIssuer } = await getTickerCikMap();

  const nameMapRows = await db.companyNameMap.findMany({
    where: { keyType: { in: ["ticker", "issuer", "cusip"] } },
    select: { keyType: true, key: true, nameZh: true, ticker: true },
  });
  const zhByTicker = new Map<string, string>();
  const tickerByIssuer = new Map<string, string>();
  const tickerByCusip = new Map<string, string>();
  for (const row of nameMapRows) {
    if (row.keyType === "ticker") {
      if (row.nameZh) zhByTicker.set(row.key.toUpperCase(), row.nameZh);
      continue;
    }
    if (row.keyType === "cusip") {
      if (row.ticker) tickerByCusip.set(row.key.toUpperCase(), row.ticker.toUpperCase());
      continue;
    }
    if (row.ticker) tickerByIssuer.set(row.key, row.ticker.toUpperCase());
  }

  const companies = await db.entity.findMany({
    where: { type: "company" },
    select: { id: true, ticker: true, cik: true, canonicalName: true },
  });
  const companyByTicker = new Map<string, { id: string; cik: string | null }>();
  const companyByIssuer = new Map<string, string>();
  const companyById = new Set<string>();
  for (const c of companies) {
    companyById.add(c.id);
    if (c.ticker) companyByTicker.set(c.ticker.toUpperCase(), { id: c.id, cik: c.cik ?? null });
    companyByIssuer.set(issuerKey(c.canonicalName), c.id);
  }

  const rows = await db.security.findMany({
    select: {
      id: true,
      entityId: true,
      ticker: true,
      cusip: true,
      companyEntityId: true,
      metadata: true,
      entity: { select: { canonicalName: true, ticker: true, metadata: true } },
    },
  });

  let kept = 0;
  let updated = 0;
  let linked = 0;
  let createdCompany = 0;
  let unresolved = 0;
  let unresolvedWithCusip = 0;

  for (const row of rows) {
    const normalizedCusip = row.cusip ? normalizeCusip(row.cusip) : null;
    const secMeta = asObj(row.metadata);
    const entMeta = asObj(row.entity.metadata);
    const existingCompanyId = row.companyEntityId ?? (typeof secMeta.companyEntityId === "string" ? secMeta.companyEntityId : null) ?? (typeof entMeta.companyEntityId === "string" ? entMeta.companyEntityId : null);

    const issuer = row.entity.canonicalName;
    const issuerK = issuerKey(issuer);

    const rawTickerCandidates = [
      row.ticker,
      row.entity.ticker,
      typeof secMeta.ticker === "string" ? secMeta.ticker : null,
      typeof entMeta.ticker === "string" ? entMeta.ticker : null,
      normalizedCusip ? tickerByCusip.get(normalizedCusip) ?? null : null,
      normalizedCusip ? CUSIP_TICKER_OVERRIDES[normalizedCusip] ?? null : null,
      tickerByIssuer.get(issuerK) ?? null,
      secTickerByIssuer.get(issuerMatchKey(issuer)) ?? null,
    ].filter((x): x is string => !!x && x.trim().length > 0);

    const resolvedTicker = rawTickerCandidates.length ? normalizeTicker(rawTickerCandidates[0]) : null;

    let companyId: string | null = null;
    if (existingCompanyId && companyById.has(existingCompanyId)) {
      companyId = existingCompanyId;
    }

    if (!companyId && resolvedTicker) {
      companyId = companyByTicker.get(resolvedTicker)?.id ?? null;
    }

    if (!companyId) {
      companyId = companyByIssuer.get(issuerK) ?? null;
    }

    if (!companyId && resolvedTicker) {
      const secRef = tickerMap.get(resolvedTicker);
      if (secRef) {
        const byCik = await db.entity.findUnique({ where: { cik: secRef.cik }, select: { id: true } });
        if (byCik) {
          companyId = byCik.id;
        } else if (!dryRun) {
          const nameEnShort = normalizeEnglishName(secRef.title);
          const nameZh = zhByTicker.get(resolvedTicker) ?? nameEnShort;
          const created = await db.entity.create({
            data: {
              type: "company",
              canonicalName: secRef.title,
              ticker: resolvedTicker,
              cik: secRef.cik,
              metadata: {
                source: "sec-edgar",
                importedBy: "backfill-security-company-links",
                nameZh,
                nameEnShort,
              },
            },
            select: { id: true },
          }).catch(async (err) => {
            // Another entity with same CIK may exist (race / legacy type). Reuse it.
            const conflict = await db.entity.findUnique({ where: { cik: secRef.cik }, select: { id: true } });
            if (conflict) return conflict;
            throw err;
          });
          companyId = created.id;
          companyById.add(created.id);
          companyByTicker.set(resolvedTicker, { id: created.id, cik: secRef.cik });
          createdCompany++;
        }
      }
    }

    const willUpdateTicker = resolvedTicker && (row.ticker ?? null) !== resolvedTicker;
    const willUpdateEntityTicker = resolvedTicker && (row.entity.ticker ?? null) !== resolvedTicker;
    const willLinkCompany = companyId && row.companyEntityId !== companyId;
    const willNormalizeCusip = normalizedCusip != null && normalizedCusip !== row.cusip;
    const hasAnyChange = Boolean(willUpdateTicker || willUpdateEntityTicker || willLinkCompany || willNormalizeCusip);

    if (!hasAnyChange) {
      kept++;
    } else {
      updated++;
      if (willLinkCompany) linked++;
    }

    if (!companyId || !resolvedTicker) {
      unresolved++;
      if (normalizedCusip) unresolvedWithCusip++;
    }

    if (dryRun || !hasAnyChange) continue;

    const nextSecMeta = { ...secMeta };
    const nextEntMeta = { ...entMeta };
    if (normalizedCusip) {
      nextSecMeta.cusip = normalizedCusip;
      nextEntMeta.cusip = normalizedCusip;
    }
    if (companyId) {
      nextSecMeta.companyEntityId = companyId;
      nextEntMeta.companyEntityId = companyId;
    }
    if (resolvedTicker) {
      nextSecMeta.ticker = resolvedTicker;
      nextEntMeta.ticker = resolvedTicker;
    }

    await db.security.update({
      where: { id: row.id },
      data: {
        cusip: normalizedCusip ?? row.cusip,
        ticker: resolvedTicker ?? row.ticker,
        companyEntityId: companyId ?? row.companyEntityId,
        metadata: nextSecMeta,
      },
    });

    await db.entity.update({
      where: { id: row.entityId },
      data: {
        ticker: resolvedTicker ?? row.entity.ticker,
        metadata: nextEntMeta,
      },
    });
  }

  const report = {
    mode: dryRun ? "dry-run" : "live",
    strict,
    totalSecurities: rows.length,
    kept,
    updated,
    linked,
    createdCompany,
    unresolved,
    unresolvedWithCusip,
  };

  console.log(JSON.stringify(report, null, 2));

  if (strict && unresolvedWithCusip > 0) {
    throw new Error(`strict mode failed: unresolvedWithCusip=${unresolvedWithCusip}`);
  }

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[backfill-security-company-links] fatal", err);
  await db.$disconnect();
  process.exit(1);
});
