import { PrismaClient } from "@prisma/client";
import { runCypher } from "@/lib/neo4j";

export interface CompareInput {
  question: string;
  fromYear: number;
  toYear: number;
  limit: number;
  sourceType: string;
}

export interface Neo4jCompareHit {
  conceptId: string | null;
  conceptZh: string | null;
  year: number | null;
  paragraphId: string | null;
  quote: string | null;
}

export interface PgCompareHit {
  id: string;
  year: number;
  title: string;
  quote: string;
}

export interface CompareOutput {
  keywords: string[];
  neo4jHits: Neo4jCompareHit[];
  pgHits: PgCompareHit[];
  summary: {
    neo4jCount: number;
    pgCount: number;
    overlap: number;
    neoOnly: number;
    pgOnly: number;
  };
}

function hasNeo4jConfig(): boolean {
  return Boolean(
    process.env.NEO4J_URI && process.env.NEO4J_USERNAME && process.env.NEO4J_PASSWORD,
  );
}

export function extractKeywords(question: string): string[] {
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

async function queryNeo4j(input: CompareInput, keywords: string[]): Promise<Neo4jCompareHit[]> {
  if (!hasNeo4jConfig()) return [];

  const rows = await runCypher<Neo4jCompareHit>(
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
      keywords,
      fromYear: input.fromYear,
      toYear: input.toYear,
      limit: input.limit,
    },
  );

  return rows;
}

async function queryPostgres(input: CompareInput, keywords: string[]): Promise<PgCompareHit[]> {
  const directUrl = process.env.DIRECT_URL;
  const prisma = directUrl
    ? new PrismaClient({ datasources: { db: { url: directUrl } } })
    : new PrismaClient();

  try {
    const rows = await prisma.chunk.findMany({
      where: {
        source: {
          year: { gte: input.fromYear, lte: input.toYear },
          type: input.sourceType,
        },
        OR: keywords.map((k) => ({ contentEn: { contains: k, mode: "insensitive" } })),
      },
      select: {
        id: true,
        contentEn: true,
        source: { select: { year: true, title: true } },
      },
      orderBy: [{ source: { year: "asc" } }, { order: "asc" }],
      take: input.limit,
    });

    return rows.map((r) => ({
      id: r.id,
      year: r.source.year,
      title: r.source.title,
      quote: r.contentEn,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

export async function runRetrievalCompare(input: CompareInput): Promise<CompareOutput> {
  const keywords = extractKeywords(input.question);
  const [neo4jHits, pgHits] = await Promise.all([
    queryNeo4j(input, keywords),
    queryPostgres(input, keywords),
  ]);

  const neoIds = new Set(neo4jHits.map((h) => h.paragraphId).filter((x): x is string => Boolean(x)));
  const pgIds = new Set(pgHits.map((h) => h.id));
  const overlap = [...neoIds].filter((id) => pgIds.has(id)).length;

  return {
    keywords,
    neo4jHits,
    pgHits,
    summary: {
      neo4jCount: neo4jHits.length,
      pgCount: pgHits.length,
      overlap,
      neoOnly: neoIds.size - overlap,
      pgOnly: pgIds.size - overlap,
    },
  };
}
