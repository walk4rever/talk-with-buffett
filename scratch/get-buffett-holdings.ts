import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const tribeId = "buffett";

  const latestHolding = await db.holding.findFirst({
    where: { holder: { tribeId } },
    orderBy: { asOfDate: "desc" },
    select: { asOfDate: true }
  });

  if (!latestHolding) {
    console.log(`No holdings found for tribe: ${tribeId}`);
    return;
  }

  const latestDate = latestHolding.asOfDate;
  console.log(`Latest holding date: ${latestDate.toISOString()}`);

  const holdings = await db.holding.findMany({
    where: { holder: { tribeId } },
    include: {
      securityProfile: {
        include: {
          company: true
        }
      }
    }
  });

  interface CompanyItem {
    id: string;
    ticker: string;
    name: string;
    type: string;
  }

  const activeCompanies = new Map<string, CompanyItem>();
  const soldOutCompanies = new Map<string, CompanyItem>();

  for (const h of holdings) {
    const company = h.securityProfile?.company;
    if (!company) continue;

    const isLatest = h.asOfDate.getTime() === latestDate.getTime();
    const isSoldOut = h.isSoldOut === true;

    const item: CompanyItem = {
      id: company.id,
      ticker: company.ticker ?? h.securityProfile?.ticker ?? "N/A",
      name: company.canonicalName,
      type: company.type
    };

    if (isLatest && !isSoldOut) {
      activeCompanies.set(company.id, item);
    } else {
      soldOutCompanies.set(company.id, item);
    }
  }

  // Remove active companies from soldOut list
  for (const key of activeCompanies.keys()) {
    soldOutCompanies.delete(key);
  }

  console.log(`Resolved current companies: ${activeCompanies.size}`);
  console.log(`Resolved sold-out companies: ${soldOutCompanies.size}`);

  const printStatusBatch = async (companiesMap: Map<string, CompanyItem>, title: string) => {
    console.log(`\n================ ${title} Companies ================`);
    const list = [...companiesMap.values()];
    list.sort((a, b) => a.ticker.localeCompare(b.ticker));

    const ids = list.map(item => item.id);
    if (ids.length === 0) {
      console.log("(None)");
      return;
    }

    // Batch query financials count
    const financialsCounts = await db.financial.groupBy({
      by: ["entityId"],
      where: {
        entityId: { in: ids },
        periodType: "FY"
      },
      _count: {
        id: true
      }
    });

    const financialsMap = new Map<string, number>();
    for (const row of financialsCounts) {
      financialsMap.set(row.entityId, row._count.id);
    }

    // Batch query existing analyses
    const analyses = await db.companyAnalysis.findMany({
      where: {
        entityId: { in: ids }
      },
      select: {
        entityId: true
      }
    });

    const analyzedSet = new Set(analyses.map(a => a.entityId));

    for (const item of list) {
      const fc = financialsMap.get(item.id) ?? 0;
      const analyzed = analyzedSet.has(item.id) ? "YES" : "NO";
      console.log(`- ${item.ticker} (${item.name}) | Type: ${item.type} | Financials: ${fc} | Analyzed: ${analyzed}`);
    }
  };

  await printStatusBatch(activeCompanies, "Current");
  await printStatusBatch(soldOutCompanies, "Sold-Out");
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
