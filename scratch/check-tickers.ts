import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const tickers = [
  "GOOGL", "GOOG", "PDD", "BRK-B", "EWBC", "BAC", "OXY", "CROX", "TME", 
  "SPGI", "HRB", "MCO", "AAPL", "MSCI", "NVDA", "MSFT", "BABA", "TSM", 
  "DIS", "CRWV", "CRDO", "ASML", "TEM"
];

async function main() {
  console.log(`Checking ${tickers.length} tickers...\n`);

  for (const ticker of tickers) {
    // Try to find the company entity
    const query = ticker;
    const byTicker = await db.entity.findFirst({
      where: {
        type: "company",
        OR: [
          { ticker: { equals: query, mode: "insensitive" } },
          { canonicalName: { contains: query, mode: "insensitive" } }
        ]
      },
      select: { id: true, canonicalName: true, ticker: true, cik: true }
    });

    if (!byTicker) {
      console.log(`- ${ticker}: NOT FOUND in database`);
      continue;
    }

    // Check financial records
    const financialCount = await db.financial.count({
      where: {
        entityId: byTicker.id,
        periodType: "FY"
      }
    });

    // Check existing analysis
    const existingAnalysis = await db.companyAnalysis.findUnique({
      where: { entityId: byTicker.id },
      select: { id: true }
    });

    console.log(`- ${ticker}: FOUND | Company: ${byTicker.canonicalName} (CIK: ${byTicker.cik ?? "N/A"}) | Financials: ${financialCount} rows | Analyzed: ${existingAnalysis ? "YES" : "NO"}`);
  }
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
