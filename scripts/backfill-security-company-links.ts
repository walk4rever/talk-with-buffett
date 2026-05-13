/**
 * backfill-security-company-links.ts
 *
 * Backfill security -> company linkage in metadata.companyEntityId.
 *
 * Strategy:
 * 1) keep existing valid companyEntityId
 * 2) map by ticker (with aliases) to existing company
 * 3) if missing, resolve ticker->CIK from SEC ticker map and create/upsert company shell
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/backfill-security-company-links.ts --dry-run
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/backfill-security-company-links.ts
 */
import { PrismaClient } from "@prisma/client";
import { normalizeEnglishName } from "../src/lib/company-name-map";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

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

function normalizeTicker(ticker: string): string {
  const raw = ticker.trim().toUpperCase();
  return TICKER_ALIASES[raw] ?? raw;
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
  for (const item of Object.values(data)) {
    map.set(item.ticker.toUpperCase(), { cik: String(item.cik_str), title: item.title });
  }
  return map;
}

async function main() {
  const tickerMap = await getTickerCikMap();
  const nameMapRows = await db.companyNameMap.findMany({
    where: { keyType: "ticker" },
    select: { key: true, nameZh: true },
  });
  const zhByTicker = new Map<string, string>();
  for (const row of nameMapRows) {
    if (row.nameZh) zhByTicker.set(row.key.toUpperCase(), row.nameZh);
  }

  const companies = await db.entity.findMany({
    where: { type: "company" },
    select: { id: true, ticker: true, cik: true },
  });
  const companyByTicker = new Map<string, string>();
  const companyById = new Set<string>();
  for (const c of companies) {
    companyById.add(c.id);
    if (c.ticker) companyByTicker.set(c.ticker.toUpperCase(), c.id);
  }

  const securities = await db.entity.findMany({
    where: { type: "security" },
    select: { id: true, ticker: true, canonicalName: true, metadata: true },
    orderBy: { ticker: "asc" },
  });

  let kept = 0;
  let linked = 0;
  let createdCompany = 0;
  let unresolved = 0;

  for (const s of securities) {
    const meta = asObj(s.metadata);
    const existingLink = typeof meta.companyEntityId === "string" ? meta.companyEntityId : null;
    if (existingLink && companyById.has(existingLink)) {
      kept++;
      continue;
    }

    const rawTicker = s.ticker?.toUpperCase() ?? null;
    const normalizedTicker = rawTicker ? normalizeTicker(rawTicker) : null;
    const candidateTickers = [rawTicker, normalizedTicker].filter(Boolean) as string[];

    let companyId: string | null = null;
    for (const t of candidateTickers) {
      const hit = companyByTicker.get(t);
      if (hit) {
        companyId = hit;
        break;
      }
    }

    if (!companyId && normalizedTicker) {
      const resolved = tickerMap.get(normalizedTicker);
      if (resolved) {
        const byCik = await db.entity.findUnique({
          where: { cik: resolved.cik },
          select: { id: true, metadata: true },
        });
        if (byCik) {
          companyId = byCik.id;
        } else {
          const nameEnShort = normalizeEnglishName(resolved.title);
          const nameZh = zhByTicker.get(normalizedTicker) ?? nameEnShort;
          const created = await db.entity.create({
            data: {
              type: "company",
              canonicalName: resolved.title,
              ticker: normalizedTicker,
              cik: resolved.cik,
              metadata: {
                source: "sec-edgar",
                importedBy: "backfill-security-company-links",
                nameZh,
                nameEnShort,
              },
            },
            select: { id: true },
          });
          companyId = created.id;
          companyByTicker.set(normalizedTicker, created.id);
          companyById.add(created.id);
          createdCompany++;
        }
      }
    }

    if (!companyId) {
      unresolved++;
      continue;
    }

    linked++;
    if (!dryRun) {
      await db.entity.update({
        where: { id: s.id },
        data: {
          metadata: {
            ...meta,
            companyEntityId: companyId,
          },
        },
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "live",
        totalSecurities: securities.length,
        kept,
        linked,
        createdCompany,
        unresolved,
      },
      null,
      2,
    ),
  );

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[backfill-security-company-links] fatal", err);
  await db.$disconnect();
  process.exit(1);
});
