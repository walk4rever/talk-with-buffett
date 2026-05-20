import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const companies = await db.entity.findMany({
    where: { type: "company" },
    select: {
      id: true,
      canonicalName: true,
      ticker: true,
      cik: true,
    },
    orderBy: { canonicalName: "asc" },
  });

  const byBucket = {
    zero: [] as typeof companies,
    oneToTwo: [] as typeof companies,
    threeToFour: [] as typeof companies,
    fivePlus: [] as typeof companies,
  };

  const details: Array<{
    id: string;
    name: string;
    ticker: string | null;
    cik: string | null;
    fyCount: number;
    fyYears: number[];
  }> = [];

  for (const c of companies) {
    // 用 distinct periodEnd 来统计有多少个不同的 FY 期
    const fyRows = await db.financial.findMany({
      where: { entityId: c.id, periodType: "FY" },
      select: { periodEnd: true },
      distinct: ["periodEnd"],
      orderBy: { periodEnd: "desc" },
    });
    const years = [...new Set(fyRows.map((f) => f.periodEnd.getUTCFullYear()))];
    const cnt = years.length;

    if (cnt === 0) byBucket.zero.push(c);
    else if (cnt <= 2) byBucket.oneToTwo.push(c);
    else if (cnt <= 4) byBucket.threeToFour.push(c);
    else byBucket.fivePlus.push(c);

    details.push({
      id: c.id,
      name: c.canonicalName,
      ticker: c.ticker,
      cik: c.cik,
      fyCount: cnt,
      fyYears: years,
    });
  }

  const report = {
    totalCompanies: companies.length,
    buckets: {
      "0 FY": byBucket.zero.length,
      "1-2 FY": byBucket.oneToTwo.length,
      "3-4 FY": byBucket.threeToFour.length,
      "5+ FY": byBucket.fivePlus.length,
    },
    missingFYCompanies: byBucket.zero.map((c) => ({
      id: c.id,
      name: c.canonicalName,
      ticker: c.ticker,
      cik: c.cik,
    })),
    detail: details.slice(0, 50),
  };

  console.log(JSON.stringify(report, null, 2));
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[check-all-company-financials] fatal", err);
  await db.$disconnect();
  process.exit(1);
});
