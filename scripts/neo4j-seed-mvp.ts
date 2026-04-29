import neo4j from "neo4j-driver";

function required(name: "NEO4J_URI" | "NEO4J_USERNAME" | "NEO4J_PASSWORD"): string {
  const v = process.env[name];
  if (!v) throw new Error(`[neo4j-seed-mvp] Missing env var: ${name}`);
  return v;
}

async function main() {
  const driver = neo4j.driver(
    required("NEO4J_URI"),
    neo4j.auth.basic(required("NEO4J_USERNAME"), required("NEO4J_PASSWORD")),
    { disableLosslessIntegers: true },
  );

  const session = driver.session();

  try {
    // Constraints
    await session.run("CREATE CONSTRAINT person_id IF NOT EXISTS FOR (n:Person) REQUIRE n.id IS UNIQUE");
    await session.run("CREATE CONSTRAINT concept_id IF NOT EXISTS FOR (n:Concept) REQUIRE n.id IS UNIQUE");
    await session.run("CREATE CONSTRAINT letter_id IF NOT EXISTS FOR (n:Letter) REQUIRE n.id IS UNIQUE");
    await session.run("CREATE CONSTRAINT paragraph_id IF NOT EXISTS FOR (n:Paragraph) REQUIRE n.id IS UNIQUE");
    await session.run("CREATE CONSTRAINT company_id IF NOT EXISTS FOR (n:Company) REQUIRE n.id IS UNIQUE");

    // Seed nodes + relations (MVP demo)
    await session.run(
      `
      MERGE (b:Person {id: "buffett"})
      SET b.name = "Warren Buffett", b.zh = "巴菲特"

      MERGE (m:Concept {id: "moat"})
      SET m.name = "Economic Moat", m.zh = "护城河"

      MERGE (f:Concept {id: "insurance_float"})
      SET f.name = "Insurance Float", f.zh = "浮存金"

      MERGE (g:Company {id: "geico"})
      SET g.name = "GEICO", g.zh = "盖可保险"

      MERGE (l95:Letter {id: "1995_shareholder_letter"})
      SET l95.year = 1995, l95.title = "Berkshire Hathaway Shareholder Letter"

      MERGE (l01:Letter {id: "2001_shareholder_letter"})
      SET l01.year = 2001, l01.title = "Berkshire Hathaway Shareholder Letter"

      MERGE (p95:Paragraph {id: "1995_p12"})
      SET p95.text = "A truly great business must have an enduring moat that protects excellent returns on invested capital."

      MERGE (p01:Paragraph {id: "2001_p08"})
      SET p01.text = "Insurance float has been central to Berkshire's ability to invest at scale over long periods."

      MERGE (l95)-[:CONTAINS]->(p95)
      MERGE (l01)-[:CONTAINS]->(p01)

      MERGE (p95)-[:MENTIONS]->(m)
      MERGE (p01)-[:MENTIONS]->(f)

      MERGE (b)-[r1:EXPLAINS]->(m)
      SET r1.year = 1995, r1.paragraph_id = "1995_p12"

      MERGE (b)-[r2:EXPLAINS]->(f)
      SET r2.year = 2001, r2.paragraph_id = "2001_p08"

      MERGE (g)-[r3:GENERATES]->(f)
      SET r3.year = 2001, r3.paragraph_id = "2001_p08"
      `,
    );

    const nodeCount = await session.run("MATCH (n) RETURN count(n) AS nodes");
    const relCount = await session.run("MATCH ()-[r]->() RETURN count(r) AS rels");

    console.log({
      ok: true,
      nodes: nodeCount.records[0]?.get("nodes"),
      rels: relCount.records[0]?.get("rels"),
    });
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
