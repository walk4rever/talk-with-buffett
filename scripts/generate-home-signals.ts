/**
 * generate-home-signals.ts
 *
 * Builds the homepage signal snapshot from latest master holdings and upserts
 * the result into HomeSignalSnapshot.
 *
 * Usage:
 *   tsx scripts/generate-home-signals.ts [--dry-run]
 */

import "dotenv/config";
import { buildHomeSignalSnapshotPayload, upsertHomeSignalSnapshot } from "@/lib/home-signals";

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  if (dryRun) console.log("🔍 Dry-run mode\n");

  const payload = await buildHomeSignalSnapshotPayload();

  console.log("Pool sizes:");
  for (const [key, cards] of Object.entries(payload.pools)) {
    console.log(`  ${key}: ${cards.length}`);
  }

  console.log(`Generated ${payload.items.length} homepage signals`);
  for (const [index, item] of payload.items.entries()) {
    console.log(`  ${index + 1}. [${item.type}] ${item.tickerLabel} — ${item.body}`);
  }

  if (!dryRun) {
    await upsertHomeSignalSnapshot(payload);
    console.log("\n✓ Home signal snapshot upserted");
  }

  console.log("\n✅ Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
