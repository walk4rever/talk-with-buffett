import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}

async function main() {
  const investors = (getArg("--investors") ?? "buffett,lilu,duan")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const fromYear = Number(getArg("--from-year") ?? "2020");

  const holdings = await db.holding.findMany({
    where: {
      holder: { tribeId: { in: investors } },
      source: { kind: "13f", periodYear: { gte: fromYear } },
    },
    select: {
      securityProfile: {
        select: {
          companyEntityId: true,
          company: { select: { id: true, canonicalName: true, ticker: true } },
        },
      },
      security: {
        select: {
          canonicalName: true,
          ticker: true,
          metadata: true,
        },
      },
    },
  });

  const byCompany = new Map<string, { id: string; name: string; ticker: string | null; refs: number }>();
  const unresolved: Array<{ issuer: string; ticker: string | null }> = [];

  for (const h of holdings) {
    const company = h.securityProfile?.company;
    if (!company || !h.securityProfile?.companyEntityId) {
      unresolved.push({ issuer: h.security.canonicalName, ticker: h.security.ticker });
      continue;
    }
    const key = company.id;
    const prev = byCompany.get(key);
    if (prev) prev.refs += 1;
    else byCompany.set(key, { id: company.id, name: company.canonicalName, ticker: company.ticker, refs: 1 });
  }

  const companies = [...byCompany.values()];
  let hasFY = 0;
  const missingFY: Array<{ companyId: string; name: string; ticker: string | null; refs: number }> = [];

  for (const c of companies) {
    const cnt = await db.financial.count({ where: { entityId: c.id, periodType: "FY" } });
    if (cnt > 0) hasFY += 1;
    else missingFY.push({ companyId: c.id, name: c.name, ticker: c.ticker, refs: c.refs });
  }

  missingFY.sort((a, b) => b.refs - a.refs);

  console.log(
    JSON.stringify(
      {
        investors,
        fromYear,
        companiesFromHoldings: companies.length,
        companiesWithFY: hasFY,
        companiesMissingFY: missingFY.length,
        unresolvedCompanyLinkRows: unresolved.length,
        missingFYSamples: missingFY.slice(0, 30),
      },
      null,
      2,
    ),
  );

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[check-financial-integrity] fatal", err);
  await db.$disconnect();
  process.exit(1);
});
