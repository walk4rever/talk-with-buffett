/**
 * Tool-use based retrieval for the chat engine.
 *
 * Flow:
 *   resolveSearch(query) — Phase 1: LLM picks tool + params (non-streaming, ~400ms)
 *   executeSearch(toolCall) — Phase 2: run the chosen search (~100ms)
 *
 * Tools available to the LLM:
 *   keyword_search  — tsvector full-text; best for names, companies, "which years", temporal
 *   semantic_search — pgvector similarity; best for opinions, philosophy, abstract concepts
 */

import prisma from "@/lib/prisma";
import type { RetrievedChunk } from "@/lib/prompts/buffett";

const AI_API_KEY = process.env.AI_API_KEY!;
const AI_API_BASE_URL = process.env.AI_API_BASE_URL!;
const AI_MODEL = process.env.AI_MODEL!;

const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY ?? AI_API_KEY;
const EMBEDDING_API_BASE_URL = process.env.EMBEDDING_API_BASE_URL ?? AI_API_BASE_URL;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "doubao-embedding-large";

// ── Tool definitions ──────────────────────────────────────────────────────

const TOOLS = [
  {
    type: "function",
    function: {
      name: "keyword_search",
      description:
        "Search Warren Buffett's writings by exact keywords (full-text search). " +
        "Best for: specific company names, people, events; " +
        "'which years did you mention X'; 'have you ever mentioned X'; " +
        "temporal/chronological questions.",
      parameters: {
        type: "object",
        properties: {
          keywords: {
            type: "string",
            description:
              "English search terms. Use | for OR alternatives: 'Progressive | Progressive Insurance'. " +
              "Translate Chinese to English. 1–3 key concepts.",
          },
          order: {
            type: "string",
            enum: ["asc", "desc", "relevance"],
            description:
              "asc = by year oldest first (for 'which years', history, changes over time). " +
              "desc = by year newest first (for 'latest', 'most recent'). " +
              "relevance = by relevance score (for opinions, explanations).",
          },
          distinct_by_year: {
            type: "boolean",
            description:
              "Return at most one result per year (the most relevant chunk for that year). " +
              "Set to true for 'which years', 'how many years', 'each year' questions.",
          },
          year_from: {
            type: "number",
            description: "Include only results from this year onwards (inclusive).",
          },
          year_to: {
            type: "number",
            description: "Include only results up to this year (inclusive).",
          },
        },
        required: ["keywords", "order"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "semantic_search",
      description:
        "Search by semantic meaning using vector similarity. " +
        "Best for: opinions, investment philosophy, 'what do you think about X', " +
        "'how do you approach Y', abstract concepts where exact wording may vary.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural language query in English describing what you are looking for.",
          },
        },
        required: ["query"],
      },
    },
  },
];

// ── Phase 1 system prompt (tool routing only) ─────────────────────────────

const TOOL_SYSTEM =
  "You are a search router for Warren Buffett's writings database.\n" +
  "The database contains shareholder letters (1965–2024), partnership letters (1957–1970), " +
  "and annual meeting transcripts (1994–2024).\n\n" +
  "Your ONLY job: call exactly one search tool with the right parameters.\n" +
  "Do NOT answer the question yourself.\n\n" +
  "Rules:\n" +
  "- keyword_search: specific names/companies, 'which years', 'have you mentioned', temporal queries\n" +
  "- semantic_search: opinions, philosophy, explanations, abstract concepts\n" +
  "- For 'which years did you mention X': keyword_search with order=asc and distinct_by_year=true\n" +
  "- Always translate Chinese keywords/queries to English";

// ── Phase 1: resolve tool call ────────────────────────────────────────────

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export async function resolveSearch(query: string): Promise<ToolCall | null> {
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
          { role: "system", content: TOOL_SYSTEM },
          { role: "user", content: query },
        ],
        tools: TOOLS,
        tool_choice: "required",
        temperature: 0,
        max_tokens: 200,
      }),
    });

    if (!res.ok) throw new Error(`API ${res.status}`);

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!raw) return null;

    const call = {
      name: raw.function.name as string,
      arguments: JSON.parse(raw.function.arguments) as Record<string, unknown>,
    };
    console.log(`[resolveSearch] tool=${call.name} args=${JSON.stringify(call.arguments)}`);
    return call;
  } catch (err) {
    console.error("[resolveSearch] error:", err);
    return null;
  }
}

// ── Phase 2: execute tool ─────────────────────────────────────────────────

export interface SearchResult {
  chunks: RetrievedChunk[];
  order: "asc" | "desc" | "relevance";
  distinctByYear: boolean;
}

export async function executeSearch(toolCall: ToolCall): Promise<SearchResult> {
  if (toolCall.name === "semantic_search") {
    const query = String(toolCall.arguments.query ?? "");
    const chunks = await runSemanticSearch(query);
    return { chunks, order: "relevance", distinctByYear: false };
  }

  // keyword_search
  const keywords = String(toolCall.arguments.keywords ?? "");
  const rawOrder = toolCall.arguments.order;
  const order = (["asc", "desc", "relevance"] as const).includes(
    rawOrder as "asc" | "desc" | "relevance",
  )
    ? (rawOrder as "asc" | "desc" | "relevance")
    : "relevance";
  const distinctByYear = toolCall.arguments.distinct_by_year === true;
  const yearFrom = typeof toolCall.arguments.year_from === "number" ? toolCall.arguments.year_from : null;
  const yearTo = typeof toolCall.arguments.year_to === "number" ? toolCall.arguments.year_to : null;

  const chunks = await runKeywordSearch({ keywords, order, distinctByYear, yearFrom, yearTo });
  return { chunks, order, distinctByYear };
}

// ── keyword_search ────────────────────────────────────────────────────────

interface KeywordParams {
  keywords: string;
  order: "asc" | "desc" | "relevance";
  distinctByYear: boolean;
  yearFrom: number | null;
  yearTo: number | null;
}

// Lower threshold for temporal/distinct-by-year to catch proper-noun company names.
// tsvector stems "Progressive" → "progress" giving low ts_rank scores for single-mention chunks.
const THRESHOLD_TEMPORAL = 0.001;
const THRESHOLD_RELEVANCE = 0.05;

/** Primary search term extracted from "Foo | Foo Bar" style keywords (first token before " | "). */
function primaryTerm(keywords: string): string {
  return keywords.split("|")[0].trim();
}

async function runKeywordSearch(p: KeywordParams): Promise<RetrievedChunk[]> {
  const threshold = p.order === "relevance" ? THRESHOLD_RELEVANCE : THRESHOLD_TEMPORAL;
  const orderClause =
    p.order === "asc" ? `l."year" ASC, score DESC` :
    p.order === "desc" ? `l."year" DESC, score DESC` :
    `score DESC`;

  try {
    if (p.distinctByYear) {
      // One chunk per year for "which years" queries.
      // Strategy: exact ILIKE match first (precise for proper nouns like company names),
      // fall back to tsvector if ILIKE returns nothing (e.g. abstract concepts with no exact match).
      const term = primaryTerm(p.keywords);
      // Use case-sensitive LIKE to avoid matching lowercase variants (e.g. "progressively" ≠ "Progressive").
      // The LLM always capitalizes proper nouns (company names), so this gives high precision.
      const likePattern = `%${term}%`;

      const ilikeRows = await prisma.$queryRawUnsafe<
        { id: string; year: number; order: number; title: string | null; sourceType: string; contentEn: string; contentZh: string | null; score: number }[]
      >(
        `
        SELECT DISTINCT ON (l."year")
          s."id",
          l."year",
          s."order",
          s."title",
          l."type"       AS "sourceType",
          s."contentEn",
          s."contentZh",
          0.1::float8 AS score
        FROM "Chunk" s
        JOIN "Source" l ON l."id" = s."sourceId"
        WHERE s."contentEn" LIKE $1
          AND ($2::int IS NULL OR l."year" >= $2)
          AND ($3::int IS NULL OR l."year" <= $3)
        ORDER BY l."year" ASC
        LIMIT 40
        `,
        likePattern, p.yearFrom ?? null, p.yearTo ?? null,
      );

      if (ilikeRows.length > 0) {
        return ilikeRows.map(toChunk);
      }

      // ILIKE found nothing — fall back to tsvector (handles abstract/philosophical queries).
      const rows = await prisma.$queryRawUnsafe<
        { id: string; year: number; order: number; title: string | null; sourceType: string; contentEn: string; contentZh: string | null; score: number }[]
      >(
        `
        SELECT DISTINCT ON (l."year")
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
        ORDER BY l."year" ASC, score DESC
        LIMIT 40
        `,
        p.keywords, threshold, p.yearFrom ?? null, p.yearTo ?? null,
      );
      return rows.map(toChunk);
    }

    const limit = p.order === "relevance" ? 8 : 20;
    const rows = await prisma.$queryRawUnsafe<
      { id: string; year: number; order: number; title: string | null; sourceType: string; contentEn: string; contentZh: string | null; score: number }[]
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
      p.keywords, threshold, p.yearFrom ?? null, p.yearTo ?? null, limit,
    );
    return rows.map(toChunk);
  } catch (err) {
    console.error("runKeywordSearch error:", err);
    return [];
  }
}

// ── semantic_search ───────────────────────────────────────────────────────

async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch(`${EMBEDDING_API_BASE_URL}/embeddings/multimodal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${EMBEDDING_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: [{ type: "text", text: text.slice(0, 4000) }],
      dimensions: 1024,
      encoding_format: "float",
    }),
  });
  if (!res.ok) throw new Error(`Embedding API ${res.status}`);
  const data = await res.json();
  return data.data.embedding;
}

async function runSemanticSearch(query: string): Promise<RetrievedChunk[]> {
  let embedding: number[];
  try {
    embedding = await getEmbedding(query);
  } catch (err) {
    console.error("Embedding failed, falling back to keyword search:", err);
    return runKeywordSearch({
      keywords: query,
      order: "relevance",
      distinctByYear: false,
      yearFrom: null,
      yearTo: null,
    });
  }

  try {
    const rows = await prisma.$queryRawUnsafe<
      { id: string; year: number; order: number; title: string | null; sourceType: string; contentEn: string; contentZh: string | null; score: number }[]
    >(
      `
      SELECT
        s."id",
        l."year",
        s."order",
        s."title",
        l."type" AS "sourceType",
        s."contentEn",
        s."contentZh",
        1 - (s."embedding" <=> $1::vector) AS score
      FROM "Chunk" s
      JOIN "Source" l ON l."id" = s."sourceId"
      WHERE s."embedding" IS NOT NULL
      ORDER BY s."embedding" <=> $1::vector
      LIMIT 8
      `,
      JSON.stringify(embedding),
    );
    return rows.map(toChunk);
  } catch (err) {
    console.error("runSemanticSearch error:", err);
    return [];
  }
}

// ── helpers ───────────────────────────────────────────────────────────────

function toChunk(r: {
  id: string; year: number; order: number; title: string | null;
  sourceType: string; contentEn: string; contentZh: string | null; score: number;
}): RetrievedChunk {
  return {
    id: r.id, year: r.year, order: r.order, title: r.title,
    sourceType: r.sourceType, contentEn: r.contentEn, contentZh: r.contentZh, score: r.score,
  };
}

// ── Main entry point ──────────────────────────────────────────────────────

export async function searchChunks(
  query: string,
): Promise<{ chunks: RetrievedChunk[]; order: "asc" | "desc" | "relevance"; distinctByYear: boolean }> {
  const toolCall = await resolveSearch(query);

  if (!toolCall) {
    const chunks = await runKeywordSearch({
      keywords: query, order: "relevance", distinctByYear: false, yearFrom: null, yearTo: null,
    });
    return { chunks, order: "relevance", distinctByYear: false };
  }

  return executeSearch(toolCall);
}
