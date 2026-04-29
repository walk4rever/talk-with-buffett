import neo4j, { type Session } from "neo4j-driver";
import { PrismaClient } from "@prisma/client";

type ConceptDef = { id: string; name: string; zh: string; keywords: string[] };
type CompanyDef = { id: string; name: string; zh: string; keywords: string[] };

const CONCEPTS: ConceptDef[] = [
  { id: "moat", name: "Economic Moat", zh: "护城河", keywords: ["moat", "durable competitive advantage"] },
  { id: "insurance_float", name: "Insurance Float", zh: "浮存金", keywords: ["float", "insurance float"] },
  { id: "circle_of_competence", name: "Circle of Competence", zh: "能力圈", keywords: ["circle of competence"] },
  { id: "margin_of_safety", name: "Margin of Safety", zh: "安全边际", keywords: ["margin of safety"] },
  { id: "capital_allocation", name: "Capital Allocation", zh: "资本配置", keywords: ["capital allocation", "allocate capital"] },
  { id: "share_repurchases", name: "Share Repurchases", zh: "股票回购", keywords: ["repurchase", "buyback"] },
  { id: "inflation", name: "Inflation", zh: "通胀", keywords: ["inflation"] },
  { id: "risk", name: "Risk", zh: "风险", keywords: ["risk"] },
];

const COMPANIES: CompanyDef[] = [
  { id: "apple", name: "Apple", zh: "苹果", keywords: ["apple", "aapl"] },
  { id: "berkshire_hathaway", name: "Berkshire Hathaway", zh: "伯克希尔·哈撒韦", keywords: ["berkshire", "berkshire hathaway"] },
  { id: "geico", name: "GEICO", zh: "盖可保险", keywords: ["geico"] },
  { id: "bnsf", name: "BNSF Railway", zh: "伯灵顿北方圣太菲铁路", keywords: ["burlington northern", "bnsf"] },
];

function required(name: "NEO4J_URI" | "NEO4J_USERNAME" | "NEO4J_PASSWORD"): string {
  const v = process.env[name];
  if (!v) throw new Error(`[neo4j-import] Missing env var: ${name}`);
  return v;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let from = 2020;
  let to = 2025;
  let sourceType = "shareholder";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from" && args[i + 1]) from = Number(args[++i]);
    else if (args[i] === "--to" && args[i + 1]) to = Number(args[++i]);
    else if (args[i] === "--type" && args[i + 1]) sourceType = args[++i] ?? sourceType;
  }

  if (Number.isNaN(from) || Number.isNaN(to)) {
    throw new Error("[neo4j-import] --from/--to must be numbers");
  }

  if (from > to) [from, to] = [to, from];
  return { from, to, sourceType };
}

function findMatchedConcepts(content: string): ConceptDef[] {
  const lc = content.toLowerCase();
  return CONCEPTS.filter((c) => c.keywords.some((k) => lc.includes(k)));
}

function findMatchedCompanies(content: string): CompanyDef[] {
  const lc = content.toLowerCase();
  return COMPANIES.filter((c) => c.keywords.some((k) => lc.includes(k)));
}

async function ensureConstraints(session: Session) {
  await session.run("CREATE CONSTRAINT person_id IF NOT EXISTS FOR (n:Person) REQUIRE n.id IS UNIQUE");
  await session.run("CREATE CONSTRAINT concept_id IF NOT EXISTS FOR (n:Concept) REQUIRE n.id IS UNIQUE");
  await session.run("CREATE CONSTRAINT letter_id IF NOT EXISTS FOR (n:Letter) REQUIRE n.id IS UNIQUE");
  await session.run("CREATE CONSTRAINT paragraph_id IF NOT EXISTS FOR (n:Paragraph) REQUIRE n.id IS UNIQUE");
  await session.run("CREATE CONSTRAINT company_id IF NOT EXISTS FOR (n:Company) REQUIRE n.id IS UNIQUE");
}

async function main() {
  const { from, to, sourceType } = parseArgs();

  const driver = neo4j.driver(
    required("NEO4J_URI"),
    neo4j.auth.basic(required("NEO4J_USERNAME"), required("NEO4J_PASSWORD")),
    { disableLosslessIntegers: true },
  );

  const prisma = process.env.DIRECT_URL
    ? new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } })
    : new PrismaClient();

  try {
    const session = driver.session();
    await ensureConstraints(session);

    await session.run(
      `
      MERGE (b:Person {id: "buffett"})
      SET b.name = "Warren Buffett", b.zh = "巴菲特"
      `,
    );

    const sources = await prisma.source.findMany({
      where: { type: sourceType, year: { gte: from, lte: to } },
      include: {
        chunks: {
          orderBy: { order: "asc" },
          select: { id: true, order: true, title: true, contentEn: true },
        },
      },
      orderBy: { year: "asc" },
    });

    if (sources.length === 0) {
      console.log(`[neo4j-import] No sources found for type=${sourceType}, years=${from}-${to}`);
      return;
    }

    let paragraphCount = 0;
    let conceptMentionCount = 0;
    let companyMentionCount = 0;

    for (const source of sources) {
      const letterId = `${source.type}_${source.year}_${source.id}`;

      await session.run(
        `
        MERGE (l:Letter {id: $letterId})
        SET l.year = $year,
            l.type = $type,
            l.title = $title,
            l.url = $url,
            l.sourceId = $sourceId
        `,
        {
          letterId,
          year: source.year,
          type: source.type,
          title: source.title,
          url: source.url,
          sourceId: source.id,
        },
      );

      for (const chunk of source.chunks) {
        paragraphCount++;

        await session.run(
          `
          MATCH (l:Letter {id: $letterId})
          MERGE (p:Paragraph {id: $paragraphId})
          SET p.order = $order,
              p.title = $chunkTitle,
              p.text = $text,
              p.sourceId = $sourceId,
              p.year = $year
          MERGE (l)-[r:CONTAINS]->(p)
          SET r.order = $order
          `,
          {
            letterId,
            paragraphId: chunk.id,
            order: chunk.order,
            chunkTitle: chunk.title,
            text: chunk.contentEn,
            sourceId: source.id,
            year: source.year,
          },
        );

        const matchedConcepts = findMatchedConcepts(chunk.contentEn);
        for (const concept of matchedConcepts) {
          conceptMentionCount++;
          await session.run(
            `
            MATCH (b:Person {id: "buffett"})
            MATCH (p:Paragraph {id: $paragraphId})
            MERGE (c:Concept {id: $conceptId})
            SET c.name = $conceptName, c.zh = $conceptZh
            MERGE (p)-[:MENTIONS]->(c)
            MERGE (b)-[r:EXPLAINS {paragraph_id: $paragraphId}]->(c)
            SET r.year = $year
            `,
            {
              paragraphId: chunk.id,
              conceptId: concept.id,
              conceptName: concept.name,
              conceptZh: concept.zh,
              year: source.year,
            },
          );
        }

        const matchedCompanies = findMatchedCompanies(chunk.contentEn);
        for (const company of matchedCompanies) {
          companyMentionCount++;
          await session.run(
            `
            MATCH (p:Paragraph {id: $paragraphId})
            MERGE (co:Company {id: $companyId})
            SET co.name = $companyName, co.zh = $companyZh
            MERGE (p)-[:MENTIONS]->(co)
            `,
            {
              paragraphId: chunk.id,
              companyId: company.id,
              companyName: company.name,
              companyZh: company.zh,
            },
          );
        }
      }

      console.log(`[neo4j-import] ${source.year} imported (${source.chunks.length} chunks)`);
    }

    const nodeCount = await session.run("MATCH (n) RETURN count(n) AS nodes");
    const relCount = await session.run("MATCH ()-[r]->() RETURN count(r) AS rels");

    console.log({
      ok: true,
      range: `${from}-${to}`,
      sourceType,
      letters: sources.length,
      paragraphs: paragraphCount,
      conceptMentions: conceptMentionCount,
      companyMentions: companyMentionCount,
      nodes: nodeCount.records[0]?.get("nodes"),
      rels: relCount.records[0]?.get("rels"),
    });

    await session.close();
  } finally {
    await prisma.$disconnect();
    await driver.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
