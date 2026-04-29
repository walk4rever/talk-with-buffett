import neo4j from "neo4j-driver";
import { PrismaClient } from "@prisma/client";

type PgHit = {
  id: string;
  year: number;
  title: string;
  contentEn: string;
};

function required(name: "NEO4J_URI" | "NEO4J_USERNAME" | "NEO4J_PASSWORD"): string {
  const value = process.env[name];
  if (!value) throw new Error(`[compare] Missing env var: ${name}`);
  return value;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1] as string;
  return fallback;
}

function intArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) {
    const n = Number(process.argv[i + 1]);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function extractKeywords(question: string): string[] {
  const q = question.toLowerCase();
  const keywords = new Set<string>();

  if (q.includes("回购") || q.includes("buyback") || q.includes("repurchase")) {
    keywords.add("share repurchases");
    keywords.add("repurchase");
    keywords.add("buyback");
    keywords.add("回购");
  }
  if (q.includes("护城河") || q.includes("moat")) {
    keywords.add("moat");
    keywords.add("护城河");
  }
  if (q.includes("浮存金") || q.includes("float")) {
    keywords.add("insurance float");
    keywords.add("float");
    keywords.add("浮存金");
  }
  if (q.includes("盖可") || q.includes("geico")) {
    keywords.add("geico");
    keywords.add("盖可");
    keywords.add("insurance");
  }

  if (keywords.size === 0) {
    for (const token of q.split(/[\s，。！？、,.!?]+/g)) {
      const t = token.trim();
      if (t.length < 2) continue;
      if (/^(19|20)\d{2}$/.test(t)) continue;
      if (t === "变化" || t === "怎么" || t === "怎么看") continue;
      keywords.add(t);
      if (keywords.size >= 8) break;
    }
  }

  return [...keywords].slice(0, 8);
}

function compact(text: string, max = 180): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

async function runNeo4jQuery(params: {
  keywords: string[];
  fromYear: number;
  toYear: number;
  limit: number;
}) {
  const driver = neo4j.driver(
    required("NEO4J_URI"),
    neo4j.auth.basic(required("NEO4J_USERNAME"), required("NEO4J_PASSWORD")),
    { disableLosslessIntegers: true },
  );

  const session = driver.session();
  try {
    const result = await session.run(
      `
      CALL {
        MATCH (b:Person {id: "buffett"})-[r:EXPLAINS]->(c:Concept)
        MATCH (p:Paragraph {id: r.paragraph_id})<-[:CONTAINS]-(l:Letter)
        WHERE ($fromYear IS NULL OR l.year >= toInteger($fromYear))
          AND ($toYear IS NULL OR l.year <= toInteger($toYear))
          AND any(k IN $keywords WHERE
            toLower(coalesce(c.id, "")) CONTAINS toLower(k)
            OR toLower(coalesce(c.name, "")) CONTAINS toLower(k)
            OR toLower(coalesce(c.zh, "")) CONTAINS toLower(k)
            OR toLower(coalesce(p.text, "")) CONTAINS toLower(k)
          )
        RETURN
          c.id AS conceptId,
          c.zh AS conceptZh,
          l.year AS year,
          p.id AS paragraphId,
          substring(coalesce(p.text, ""), 0, 220) AS quote
        UNION
        MATCH (co:Company)<-[:MENTIONS]-(p:Paragraph)<-[:CONTAINS]-(l:Letter)
        WHERE ($fromYear IS NULL OR l.year >= toInteger($fromYear))
          AND ($toYear IS NULL OR l.year <= toInteger($toYear))
          AND any(k IN $keywords WHERE
            toLower(coalesce(co.id, "")) CONTAINS toLower(k)
            OR toLower(coalesce(co.name, "")) CONTAINS toLower(k)
            OR toLower(coalesce(co.zh, "")) CONTAINS toLower(k)
            OR toLower(coalesce(p.text, "")) CONTAINS toLower(k)
          )
        RETURN
          co.id AS conceptId,
          co.zh AS conceptZh,
          l.year AS year,
          p.id AS paragraphId,
          substring(coalesce(p.text, ""), 0, 220) AS quote
      }
      RETURN conceptId, conceptZh, year, paragraphId, quote
      ORDER BY year ASC
      LIMIT toInteger($limit)
      `,
      {
        keywords: params.keywords,
        fromYear: params.fromYear,
        toYear: params.toYear,
        limit: params.limit,
      },
    );

    return result.records.map((r) => ({
      conceptId: r.get("conceptId") as string | null,
      conceptZh: r.get("conceptZh") as string | null,
      year: r.get("year") as number | null,
      paragraphId: r.get("paragraphId") as string | null,
      quote: r.get("quote") as string | null,
    }));
  } finally {
    await session.close();
    await driver.close();
  }
}

async function runPgQuery(params: {
  keywords: string[];
  fromYear: number;
  toYear: number;
  limit: number;
  sourceType: string;
}): Promise<PgHit[]> {
  const prisma = process.env.DIRECT_URL
    ? new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } })
    : new PrismaClient();

  try {
    const rows = await prisma.chunk.findMany({
      where: {
        source: {
          year: { gte: params.fromYear, lte: params.toYear },
          type: params.sourceType,
        },
        OR: params.keywords.map((k) => ({
          contentEn: { contains: k, mode: "insensitive" },
        })),
      },
      select: {
        id: true,
        contentEn: true,
        source: { select: { year: true, title: true } },
      },
      orderBy: [{ source: { year: "asc" } }, { order: "asc" }],
      take: params.limit,
    });

    return rows.map((r) => ({
      id: r.id,
      year: r.source.year,
      title: r.source.title,
      contentEn: r.contentEn,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const question = arg("--question", "2020 到 2025 巴菲特怎么看回购？");
  const fromYear = intArg("--from", 2020);
  const toYear = intArg("--to", 2025);
  const limit = intArg("--limit", 12);
  const sourceType = arg("--type", "shareholder");
  const keywords = extractKeywords(question);

  const [neo4jHits, pgHits] = await Promise.all([
    runNeo4jQuery({ keywords, fromYear, toYear, limit }),
    runPgQuery({ keywords, fromYear, toYear, limit, sourceType }),
  ]);

  console.log("\n=== Retrieval Compare ===");
  console.log("question:", question);
  console.log("keywords:", keywords.join(", "));
  console.log("range:", `${fromYear}-${toYear}`);

  const neoIds = new Set(neo4jHits.map((h) => h.paragraphId).filter((x): x is string => Boolean(x)));
  const pgIds = new Set(pgHits.map((h) => h.id));

  const intersection = [...neoIds].filter((id) => pgIds.has(id));
  const onlyNeo = [...neoIds].filter((id) => !pgIds.has(id));
  const onlyPg = [...pgIds].filter((id) => !neoIds.has(id));

  console.log("\n--- Compare Summary ---");
  console.log({
    neo4jCount: neo4jHits.length,
    pgCount: pgHits.length,
    overlap: intersection.length,
    neoOnly: onlyNeo.length,
    pgOnly: onlyPg.length,
  });

  if (intersection.length > 0) {
    console.log("overlapIds:", intersection.slice(0, 20));
  }
  if (onlyNeo.length > 0) {
    console.log("neoOnlyIds:", onlyNeo.slice(0, 20));
  }
  if (onlyPg.length > 0) {
    console.log("pgOnlyIds:", onlyPg.slice(0, 20));
  }

  console.log("\n--- Neo4j hits ---");
  console.log(`count: ${neo4jHits.length}`);
  for (const hit of neo4jHits) {
    console.log({
      year: hit.year,
      concept: hit.conceptZh ?? hit.conceptId,
      paragraphId: hit.paragraphId,
      quote: compact(hit.quote ?? ""),
    });
  }

  console.log("\n--- PostgreSQL hits ---");
  console.log(`count: ${pgHits.length}`);
  for (const hit of pgHits) {
    console.log({
      year: hit.year,
      chunkId: hit.id,
      title: hit.title,
      quote: compact(hit.contentEn),
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
