import { PrismaClient } from "@prisma/client";
import {
  fetchSecSubmissions,
  mapSectorFromSic,
  pickCompanyProfile,
} from "./lib/sec-company-profile";

const db = new PrismaClient();

type Args = {
  limit: number | null;
  cik: string | null;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => argv.find((_, i) => argv[i - 1] === flag) ?? null;
  const has = (flag: string) => argv.includes(flag);
  const limitRaw = get("--limit");
  const limit = limitRaw ? Math.max(1, Number.parseInt(limitRaw, 10)) : null;
  const cikRaw = get("--cik");
  const cik = cikRaw ? cikRaw.replace(/\D/g, "") : null;
  return {
    limit: Number.isFinite(limit ?? Number.NaN) ? limit : null,
    cik,
    dryRun: has("--dry-run"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = await db.entity.findMany({
    where: {
      type: "company",
      cik: args.cik ?? { not: null },
    },
    select: {
      id: true,
      cik: true,
      ticker: true,
      canonicalName: true,
      sector: true,
      metadata: true,
    },
    orderBy: { canonicalName: "asc" },
    ...(args.limit ? { take: args.limit } : {}),
  });

  let updated = 0;
  let skipped = 0;
  const failures: Array<{ cik: string; error: string }> = [];

  for (const row of rows) {
    const cik = row.cik;
    if (!cik) {
      skipped++;
      continue;
    }

    try {
      const submissions = await fetchSecSubmissions(cik);
      const profile = pickCompanyProfile(submissions);
      const existingMeta = (row.metadata as Record<string, unknown> | null) ?? {};
      const nextSector = mapSectorFromSic(profile.sic, profile.sicDescription) ?? row.sector ?? null;
      const nextMeta = {
        ...existingMeta,
        source: "sec-edgar",
        industry: profile.sicDescription,
        exchange: profile.exchanges[0] ?? null,
        exchanges: profile.exchanges,
        sic: profile.sic,
        secCategory: profile.category,
        fiscalYearEnd: profile.fiscalYearEnd,
        stateOfIncorporation: profile.stateOfIncorporation,
        stateOfIncorporationDescription: profile.stateOfIncorporationDescription,
      };

      const changed =
        row.sector !== nextSector ||
        JSON.stringify(existingMeta) !== JSON.stringify(nextMeta);

      if (!changed) {
        skipped++;
        continue;
      }

      if (!args.dryRun) {
        await db.entity.update({
          where: { id: row.id },
          data: {
            sector: nextSector,
            metadata: nextMeta,
          },
        });
      }

      updated++;
      console.log(
        JSON.stringify({
          cik,
          ticker: row.ticker,
          sector: nextSector,
          industry: profile.sicDescription,
          exchange: profile.exchanges[0] ?? null,
          mode: args.dryRun ? "dry-run" : "live",
        }),
      );
    } catch (error) {
      failures.push({
        cik,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        total: rows.length,
        updated,
        skipped,
        failures,
        mode: args.dryRun ? "dry-run" : "live",
      },
      null,
      2,
    ),
  );
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error("[backfill-company-profiles] fatal", error);
  await db.$disconnect();
  process.exit(1);
});
