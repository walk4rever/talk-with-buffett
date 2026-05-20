import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const masters = await db.entity.findMany({
    where: { type: "master" }
  });
  console.log("Master Entities:", masters);
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
