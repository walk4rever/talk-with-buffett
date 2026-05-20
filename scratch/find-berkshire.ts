import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const entityId = 'cmp0pp1vd0000rscnjpdvdbai'; // Berkshire Hathaway Inc
  const count = await db.financial.count({
    where: { entityId }
  });
  console.log(`Financials count for Berkshire: ${count}`);

  const sample = await db.financial.findMany({
    where: { entityId, periodType: "FY" },
    take: 5
  });
  console.log("Sample financials:", sample);
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
