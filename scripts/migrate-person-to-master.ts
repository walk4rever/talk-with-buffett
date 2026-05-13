/**
 * migrate-person-to-master.ts
 *
 * One-off migration:
 *   Entity.type "person" -> "master"
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/migrate-person-to-master.ts --dry-run
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/migrate-person-to-master.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const rows = await db.entity.findMany({
    where: { type: "person" },
    select: { id: true, canonicalName: true, tribeId: true, cik: true },
    orderBy: { canonicalName: "asc" },
  });

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "live",
        count: rows.length,
        rows,
      },
      null,
      2,
    ),
  );

  if (!dryRun && rows.length) {
    const res = await db.entity.updateMany({
      where: { type: "person" },
      data: { type: "master" },
    });
    console.log(`[migrate-person-to-master] updated=${res.count}`);
  }

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[migrate-person-to-master] fatal", err);
  await db.$disconnect();
  process.exit(1);
});

