/**
 * Neo4j Schema v2 — Multi-investor knowledge graph
 * Resets all data and creates new constraints + seed investors.
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/ts-node --esm scripts/neo4j-schema-v2.ts
 *   Add --reset to wipe existing data first (required for schema migration)
 */

import neo4j from "neo4j-driver";

function required(name: "NEO4J_URI" | "NEO4J_USERNAME" | "NEO4J_PASSWORD"): string {
  const v = process.env[name];
  if (!v) throw new Error(`[schema-v2] Missing env var: ${name}`);
  return v;
}

const INVESTORS = [
  { id: "buffett", name: "Warren Buffett", zh: "沃伦·巴菲特", style: "value" },
  { id: "munger",  name: "Charlie Munger",  zh: "查理·芒格",   style: "value" },
  { id: "graham",  name: "Benjamin Graham", zh: "本杰明·格雷厄姆", style: "value" },
  { id: "lynch",   name: "Peter Lynch",     zh: "彼得·林奇",   style: "growth_value" },
  { id: "klarman", name: "Seth Klarman",    zh: "塞思·卡拉曼", style: "deep_value" },
];

async function main() {
  const reset = process.argv.includes("--reset");

  const driver = neo4j.driver(
    required("NEO4J_URI"),
    neo4j.auth.basic(required("NEO4J_USERNAME"), required("NEO4J_PASSWORD")),
    { disableLosslessIntegers: true },
  );
  const session = driver.session();

  try {
    if (reset) {
      console.log("[schema-v2] Wiping all data...");
      await session.run("MATCH (n) DETACH DELETE n");
      console.log("[schema-v2] Done.");
    }

    // ── Constraints ──────────────────────────────────────────────
    const constraints = [
      "CREATE CONSTRAINT investor_id  IF NOT EXISTS FOR (n:Investor)  REQUIRE n.id IS UNIQUE",
      "CREATE CONSTRAINT document_id  IF NOT EXISTS FOR (n:Document)  REQUIRE n.id IS UNIQUE",
      "CREATE CONSTRAINT paragraph_id IF NOT EXISTS FOR (n:Paragraph) REQUIRE n.id IS UNIQUE",
      "CREATE CONSTRAINT concept_id   IF NOT EXISTS FOR (n:Concept)   REQUIRE n.id IS UNIQUE",
      "CREATE CONSTRAINT company_id   IF NOT EXISTS FOR (n:Company)   REQUIRE n.id IS UNIQUE",
      "CREATE CONSTRAINT person_id    IF NOT EXISTS FOR (n:Person)    REQUIRE n.id IS UNIQUE",
    ];
    for (const c of constraints) await session.run(c);
    console.log("[schema-v2] Constraints created.");

    // ── Seed investors ────────────────────────────────────────────
    for (const inv of INVESTORS) {
      await session.run(
        `MERGE (i:Investor {id: $id})
         SET i.name = $name, i.zh = $zh, i.style = $style`,
        inv,
      );
    }
    console.log("[schema-v2] Investors seeded:", INVESTORS.map((i) => i.id).join(", "));

    // ── Summary ───────────────────────────────────────────────────
    const nodeCount = await session.run("MATCH (n) RETURN count(n) AS n");
    console.log("[schema-v2] Total nodes:", nodeCount.records[0]?.get("n"));
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
