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

  const rows = await runCypher<GraphInsight>(
    `
    UNWIND $entities AS q
    MATCH (a)-[r]->(b)
    WHERE (
      toLower(coalesce(a.name, a.zh, a.id, "")) CONTAINS toLower(q)
      OR toLower(coalesce(b.name, b.zh, b.id, "")) CONTAINS toLower(q)
    )
    OPTIONAL MATCH (p:Paragraph {id: r.paragraph_id})
    OPTIONAL MATCH (p)<-[:CONTAINS]-(l:Letter)
    WHERE ($yearFrom IS NULL OR l.year >= $yearFrom)
      AND ($yearTo IS NULL OR l.year <= $yearTo)
    RETURN DISTINCT
      type(r) AS relation,
      coalesce(a.zh, a.name, a.id, labels(a)[0]) AS from,
      coalesce(b.zh, b.name, b.id, labels(b)[0]) AS to,
      l.year AS year,
      p.text AS quote,
      p.id AS paragraphId
    ORDER BY year DESC
    LIMIT $limit
    `,
    {
      entities,
      yearFrom: params.yearFrom,
      yearTo: params.yearTo,
      limit,
    },
  );

  return rows;
}
