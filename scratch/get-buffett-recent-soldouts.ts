import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const tribeId = "buffett";

  // Find the latest asOfDate for holdings of this tribe
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

  // Fetch all holdings sorted by date descending to find the last quarter they were held
  const holdings = await db.holding.findMany({
    where: { holder: { tribeId } },
    include: {
      securityProfile: {
        include: {
          company: true
        }
      }
    },
    orderBy: { asOfDate: "desc" }
  });

  const lastHeldDate = new Map<string, Date>();
  const wasSoldOutExplicitly = new Map<string, boolean>();
  const companyInfo = new Map<string, { ticker: string; name: string; id: string }>();

  for (const h of holdings) {
    const company = h.securityProfile?.company;
    if (!company) continue;

    const id = company.id;
    if (!lastHeldDate.has(id)) {
      lastHeldDate.set(id, h.asOfDate);
      wasSoldOutExplicitly.set(id, h.isSoldOut === true);
      companyInfo.set(id, {
        id,
        ticker: company.ticker ?? h.securityProfile?.ticker ?? "N/A",
        name: company.canonicalName
      });
    }
  }

  // Find companies whose last held date is before the latestDate, OR they were explicitly marked isSoldOut on the latestDate
  const soldOutList = [];
  for (const [id, lastDate] of lastHeldDate.entries()) {
    const info = companyInfo.get(id)!;
    const explicitlySold = wasSoldOutExplicitly.get(id)!;

    if (lastDate.getTime() < latestDate.getTime() || explicitlySold) {
      soldOutList.push({
        ...info,
        lastDate,
        explicitlySold
      });
    }
  }

  // Sort by lastDate descending (most recent first)
  soldOutList.sort((a, b) => b.lastDate.getTime() - a.lastDate.getTime());

  console.log("\n================ Sold-Out Positions by Last Held Date ================");
  for (const item of soldOutList) {
    // Count financials
    const financialsCount = await db.financial.count({
      where: { entityId: item.id, periodType: "FY" }
    });

    const existingAnalysis = await db.companyAnalysis.findUnique({
      where: { entityId: item.id },
      select: { id: true }
    });

    console.log(`- ${item.ticker} (${item.name}) | Last Held: ${item.lastDate.toISOString().slice(0, 10)} | Explicitly Sold: ${item.explicitlySold} | Financials: ${financialsCount} | Analyzed: ${existingAnalysis ? "YES" : "NO"}`);
  }
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
