import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const row = await db.companyNameMap.findFirst({
    where: {
      OR: [
        { key: { equals: "BRK-B", mode: "insensitive" } },
        { key: { contains: "Berkshire", mode: "insensitive" } }
      ]
    }
  });
  console.log("CompanyNameMap match:", row);

  const rows = await db.companyNameMap.findMany({
    where: {
      nameZh: { contains: "伯克希尔" }
    }
  });
  console.log("CompanyNameMap matching '伯克希尔':", rows);
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
