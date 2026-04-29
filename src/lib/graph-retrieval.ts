import { runCypher } from "@/lib/neo4j";

export interface GraphInsight {
  relation: string;
  from: string;
  to: string;
  year: number | null;
  quote: string | null;
  paragraphId: string | null;
}

export async function fetchGraphInsights(params: {
  entities: string[];
  yearFrom: number | null;
  yearTo: number | null;
  limit?: number;
}): Promise<GraphInsight[]> {
  const entities = params.entities
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .slice(0, 6);

  if (entities.length === 0) return [];

  const limit = Math.min(Math.max(params.limit ?? 6, 1), 20);

  // Query v2 schema: Paragraph -[:MENTIONS_CONCEPT|MENTIONS_COMPANY]-> entity
  const rows = await runCypher<GraphInsight>(
    `
    UNWIND $entities AS q
    MATCH (p:Paragraph)-[r:MENTIONS_CONCEPT|MENTIONS_COMPANY]->(e)
    WHERE (
      toLower(coalesce(e.name, e.zh, e.id, "")) CONTAINS toLower(q)
      OR toLower(coalesce(e.id, "")) CONTAINS toLower(q)
    )
    AND ($yearFrom IS NULL OR p.year >= $yearFrom)
    AND ($yearTo   IS NULL OR p.year <= $yearTo)
    RETURN DISTINCT
      type(r)                                              AS relation,
      coalesce(p.title, "Paragraph")                      AS from,
      coalesce(e.zh, e.name, e.id)                        AS to,
      p.year                                              AS year,
      p.id                                                AS paragraphId,
      null                                                AS quote
    ORDER BY year DESC
    LIMIT $limit
    `,
    { entities, yearFrom: params.yearFrom, yearTo: params.yearTo, limit },
  );

  return rows;
}
