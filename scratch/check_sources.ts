import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: ".env.local" });
const prisma = new PrismaClient();

async function main() {
  const counts = await prisma.source.groupBy({
    by: ["type"],
    _count: {
      _all: true,
    },
  });

  console.log("Source counts by type:");
  console.log(JSON.stringify(counts, null, 2));

  const sampleMeetings = await prisma.source.findMany({
    where: { type: "annual_meeting" },
    take: 5,
    orderBy: { year: "desc" },
  });

  console.log("\nSample annual meetings:");
  console.log(JSON.stringify(sampleMeetings, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
