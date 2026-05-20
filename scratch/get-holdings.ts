import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const holders = await db.entity.findMany({
    where: {
      OR: [
        { canonicalName: { contains: "Himalaya", mode: "insensitive" } },
        { canonicalName: { contains: "Li Lu", mode: "insensitive" } },
        { canonicalName: { contains: "Duan", mode: "insensitive" } },
        { canonicalName: { contains: "H&H", mode: "insensitive" } }, 
        { tribeId: { in: ["lilu", "duan"] } }
      ]
    },
    select: { id: true, canonicalName: true, tribeId: true, type: true }
  });

  console.log("Found holder/tribe entities:", holders);

  const tribes = ["lilu", "duan"];

  for (const tribeId of tribes) {
    console.log(`\n================ Holdings for tribe: ${tribeId} ================`);
    
    // Find the latest asOfDate for holdings of this tribe
    const latestHolding = await db.holding.findFirst({
      where: {
        holder: { tribeId }
      },
      orderBy: { asOfDate: "desc" },
      select: { asOfDate: true }
    });

    if (!latestHolding) {
      console.log(`No holdings found for tribe: ${tribeId}`);
      continue;
    }

    const latestDate = latestHolding.asOfDate;
    console.log(`Latest holding date: ${latestDate.toISOString()}`);

    // Query holdings on the latest date for this tribe
    const holdings = await db.holding.findMany({
      where: {
        holder: { tribeId },
        asOfDate: latestDate
      },
      include: {
        security: {
          select: {
            id: true,
            canonicalName: true,
            ticker: true,
            cik: true
          }
        }
      },
      orderBy: { valueUsd: "desc" }
    });

    console.log(`Found ${holdings.length} holdings:`);
    for (const h of holdings) {
      const co = h.security;
      console.log(`- ${co.canonicalName} (${co.ticker ?? "N/A"}) | Value: $${h.valueUsd ? (Number(h.valueUsd) / 1e6).toFixed(2) + "M" : "N/A"}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
