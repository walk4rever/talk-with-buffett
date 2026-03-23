/**
 * Keyword-based search using tsvector full-text with temporal awareness.
 *
 * Flow: parseQuery() → QueryPlan → keywordSearch() → RetrievedChunk[]
 *
 * parseQuery extracts both search keywords (English) and temporal intent
 * (order: asc / desc / relevance, optional year range) from the user question.
 * keywordSearch runs a single tsvector scan with dynamic ORDER BY and year filters.
 */

import prisma from "@/lib/prisma";
import type { RetrievedChunk } from "@/lib/prompts/buffett";

const AI_API_KEY = process.env.AI_API_KEY!;
const AI_API_BASE_URL = process.env.AI_API_BASE_URL!;
const AI_MODEL = process.env.AI_MODEL!;

// ── Query plan ────────────────────────────────────────────────────────────

export interface QueryPlan {
  keywords: string;
  order: "asc" | "desc" | "relevance";
  yearFrom: number | null;
  yearTo: number | null;
}

// ── Parse query ───────────────────────────────────────────────────────────

const PARSE_SYSTEM = `You are a search query parser for Warren Buffett's writings database (shareholder letters 1965-2024, partnership letters 1957-1970, annual meetings 1994-2024).

Given the user question, output ONLY a JSON object with these exact fields:
{
  "keywords": string,         // English search terms for PostgreSQL websearch_to_tsquery. Use | between alternatives: "Progressive | Progressive Insurance". 1-3 key concepts max.
  "order": "asc"|"desc"|"relevance",  // asc=first mention/history/changes over time, desc=latest/most recent, relevance=opinion/what does he think/how to
  "yearFrom": number|null,    // lower year bound if mentioned ("after 2008"→2008, "1990s"→1990), else null
  "yearTo": number|null       // upper year bound if mentioned ("before 2000"→2000, "1990s"→1999), else null
}

Examples:
"最早提到前进保险是哪一年" → {"keywords":"Progressive | Progressive Insurance","order":"asc","yearFrom":null,"yearTo":null}
"有没有提到过比特币" → {"keywords":"bitcoin | cryptocurrency","order":"asc","yearFrom":null,"yearTo":null}
"历年对保险业务的看法变化" → {"keywords":"insurance business","order":"asc","yearFrom":null,"yearTo":null}
"最近怎么看科技股" → {"keywords":"technology stocks | tech companies","order":"desc","yearFrom":2015,"yearTo":null}
"2008年金融危机时说了什么" → {"keywords":"financial crisis | bank failure | recession","order":"relevance","yearFrom":2007,"yearTo":2010}
"怎么看护城河" → {"keywords":"economic moat | competitive advantage","order":"relevance","yearFrom":null,"yearTo":null}
"查理芒格去世后你说了什么" → {"keywords":"Charlie Munger death | Charlie Munger passed","order":"relevance","yearFrom":2023,"yearTo":2024}

Output ONLY valid JSON, no markdown, no explanation.`;

export async function parseQuery(query: string): Promise<QueryPlan> {
  try {
    const res = await fetch(`${AI_API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: PARSE_SYSTEM },
          { role: "user", content: query },
        ],
        temperature: 0,
        max_tokens: 150,
      }),
    });

    if (!res.ok) throw new Error(`API ${res.status}`);

    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content?.trim() ?? "";

    // Strip optional ```json ... ``` wrapper
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const plan = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const order = (["asc", "desc", "relevance"] as const).includes(plan.order as "asc" | "desc" | "relevance")
      ? (plan.order as "asc" | "desc" | "relevance")
      : "relevance";

    return {
      keywords: typeof plan.keywords === "string" && plan.keywords.trim()
        ? plan.keywords.trim()
        : query,
      order,
      yearFrom: typeof plan.yearFrom === "number" ? plan.yearFrom : null,
      yearTo: typeof plan.yearTo === "number" ? plan.yearTo : null,
    };
  } catch {
    // Fallback: use original query as-is with relevance ordering
    return { keywords: query, order: "relevance", yearFrom: null, yearTo: null };
  }
}

// ── Keyword search ────────────────────────────────────────────────────────

// Temporal queries use a lower threshold to avoid missing rare mentions.
const THRESHOLD_TEMPORAL = 0.02;
const THRESHOLD_RELEVANCE = 0.05;
const LIMIT_TEMPORAL = 20;
const LIMIT_RELEVANCE = 8;

export async function keywordSearch(plan: QueryPlan): Promise<RetrievedChunk[]> {
  const { keywords, order, yearFrom, yearTo } = plan;

  const threshold = order === "relevance" ? THRESHOLD_RELEVANCE : THRESHOLD_TEMPORAL;
  const limit = order === "relevance" ? LIMIT_RELEVANCE : LIMIT_TEMPORAL;

  // ORDER BY is constructed from a validated enum — not from user input.
  const orderClause =
    order === "asc" ? `l."year" ASC, score DESC` :
    order === "desc" ? `l."year" DESC, score DESC` :
    `score DESC`;

  try {
    const results = await prisma.$queryRawUnsafe<
      {
        id: string;
        year: number;
        order: number;
        title: string | null;
        sourceType: string;
        contentEn: string;
        contentZh: string | null;
        score: number;
      }[]
    >(
      `
      SELECT
        s."id",
        l."year",
        s."order",
        s."title",
        l."type"       AS "sourceType",
        s."contentEn",
        s."contentZh",
        ts_rank_cd(s."searchVector", websearch_to_tsquery('english', $1)) AS score
      FROM "Chunk" s
      JOIN "Source" l ON l."id" = s."sourceId"
      WHERE s."searchVector" @@ websearch_to_tsquery('english', $1)
        AND ts_rank_cd(s."searchVector", websearch_to_tsquery('english', $1)) > $2
        AND ($3::int IS NULL OR l."year" >= $3)
        AND ($4::int IS NULL OR l."year" <= $4)
      ORDER BY ${orderClause}
      LIMIT $5
      `,
      keywords,
      threshold,
      yearFrom ?? null,
      yearTo ?? null,
      limit,
    );

    return results.map((r) => ({
      id: r.id,
      year: r.year,
      order: r.order,
      title: r.title,
      sourceType: r.sourceType,
      contentEn: r.contentEn,
      contentZh: r.contentZh,
      score: r.score,
    }));
  } catch (err) {
    console.error("keywordSearch error:", err);
    return [];
  }
}

// ── Main entry point ──────────────────────────────────────────────────────

export async function searchChunks(
  query: string,
): Promise<{ chunks: RetrievedChunk[]; order: "asc" | "desc" | "relevance" }> {
  const plan = await parseQuery(query);
  const chunks = await keywordSearch(plan);
  return { chunks, order: plan.order };
}
