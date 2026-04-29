import neo4j from "neo4j-driver";

function required(name: "NEO4J_URI" | "NEO4J_USERNAME" | "NEO4J_PASSWORD"): string {
  const value = process.env[name];
  if (!value) throw new Error(`[neo4j-test] Missing env var: ${name}`);
  return value;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1] as string;
  return fallback;
}

function intArg(name: string): number | null {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) return null;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : null;
}

function extractKeywords(question: string): string[] {
  const q = question.toLowerCase();
  const keywords = new Set<string>();

  if (q.includes("回购") || q.includes("buyback") || q.includes("repurchase")) {
    keywords.add("share repurchases");
    keywords.add("回购");
  }
  if (q.includes("护城河") || q.includes("moat")) {
    keywords.add("moat");
    keywords.add("护城河");
  }
  if (q.includes("浮存金") || q.includes("float")) {
    keywords.add("insurance float");
    keywords.add("浮存金");
  }
  if (q.includes("能力圈") || q.includes("circle of competence")) {
    keywords.add("circle of competence");
    keywords.add("能力圈");
  }

  if (keywords.size === 0) {
    for (const token of q.split(/[\s，。！？、,.!?]+/g)) {
      const t = token.trim();
      if (t.length >= 2) keywords.add(t);
      if (keywords.size >= 6) break;
    }
  }

  return [...keywords];
}

async function main() {
  const question = arg("--question", "2020 到 2025 巴菲特怎么看回购？");
  const fromYear = intArg("--from") ?? 2020;
  const toYear = intArg("--to") ?? 2025;
  const limit = intArg("--limit") ?? 12;
  const keywords = extractKeywords(question);

  const driver = neo4j.driver(
    required("NEO4J_URI"),
    neo4j.auth.basic(required("NEO4J_USERNAME"), required("NEO4J_PASSWORD")),
    { disableLosslessIntegers: true },
  );

  const session = driver.session();
  try {
    const rows = await session.run(
      `
      MATCH (b:Person {id: "buffett"})-[r:EXPLAINS]->(c:Concept)
      OPTIONAL MATCH (p:Paragraph {id: r.paragraph_id})<-[:CONTAINS]-(l:Letter)
      WHERE ($fromYear IS NULL OR l.year >= toInteger($fromYear))
        AND ($toYear IS NULL OR l.year <= toInteger($toYear))
        AND any(k IN $keywords WHERE
          toLower(coalesce(c.id, "")) CONTAINS toLower(k)
          OR toLower(coalesce(c.name, "")) CONTAINS toLower(k)
          OR toLower(coalesce(c.zh, "")) CONTAINS toLower(k)
        )
      RETURN
        c.id AS conceptId,
        c.name AS conceptName,
        c.zh AS conceptZh,
        type(r) AS relation,
        r.year AS relationYear,
        l.year AS letterYear,
        p.id AS paragraphId,
        substring(coalesce(p.text, ""), 0, 180) AS quote
      ORDER BY letterYear ASC
      LIMIT toInteger($limit)
      `,
      { fromYear, toYear, keywords, limit },
    );

    const summary = await session.run(
      `
      MATCH (n) RETURN count(n) AS nodes
      `,
    );

    console.log("[neo4j-test] question:", question);
    console.log("[neo4j-test] keywords:", keywords.join(", "));
    console.log("[neo4j-test] year range:", `${fromYear}-${toYear}`);
    console.log("[neo4j-test] total nodes:", summary.records[0]?.get("nodes"));
    console.log("[neo4j-test] hits:", rows.records.length);

    for (const record of rows.records) {
      console.log({
        conceptId: record.get("conceptId"),
        concept: record.get("conceptZh") || record.get("conceptName"),
        relation: record.get("relation"),
        relationYear: record.get("relationYear"),
        letterYear: record.get("letterYear"),
        paragraphId: record.get("paragraphId"),
        quote: record.get("quote"),
      });
    }
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
