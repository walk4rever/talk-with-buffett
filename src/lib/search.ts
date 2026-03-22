/**
 * Hybrid search: tsvector full-text + pgvector semantic, merged and ranked.
 */

import prisma from "@/lib/prisma";
import type { RetrievedChunk } from "@/lib/prompts/buffett";

const AI_API_KEY = process.env.AI_API_KEY!;
const AI_API_BASE_URL = process.env.AI_API_BASE_URL!;

const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY ?? AI_API_KEY;
const EMBEDDING_API_BASE_URL = process.env.EMBEDDING_API_BASE_URL ?? AI_API_BASE_URL;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "doubao-embedding-large";

// ── Query translation ────────────────────────────────────────────────────

const AI_MODEL = process.env.AI_MODEL!;

export async function translateQuery(query: string): Promise<string> {
  const res = await fetch(`${AI_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "Translate the user's question into English. If already in English, return as-is. " +
            "Expand with synonyms useful for searching Warren Buffett's shareholder letters. " +
            "Output ONLY the translated/expanded query, nothing else.",
        },
        { role: "user", content: query },
      ],
      temperature: 0,
      max_tokens: 200,
    }),
  });

  if (!res.ok) {
    // Fallback: use original query
    return query;
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? query;
}

// ── Embedding ────────────────────────────────────────────────────────────

export async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch(`${EMBEDDING_API_BASE_URL}/embeddings/multimodal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${EMBEDDING_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: [{ type: "text", text }],
      dimensions: 1024,
      encoding_format: "float",
    }),
  });

  if (!res.ok) {
    throw new Error(`Embedding API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  // Multimodal API returns data.embedding (object), not data[0].embedding (array)
  return data.data.embedding;
}

// ── Hybrid search ────────────────────────────────────────────────────────

interface HybridResult {
  id: string;
  letterId: string;
  year: number;
  order: number;
  title: string | null;
  contentEn: string;
  contentZh: string | null;
  vectorScore: number;
  keywordScore: number;
  finalScore: number;
}

const VECTOR_WEIGHT = 0.7;
const KEYWORD_WEIGHT = 0.3;

export async function hybridSearch(
  translatedQuery: string,
  queryEmbedding: number[],
  limit: number = 5,
): Promise<RetrievedChunk[]> {
  // Single SQL query: run both searches, merge, and rank
  const results = await prisma.$queryRawUnsafe<HybridResult[]>(
    `
    WITH vector_search AS (
      SELECT
        s."id",
        s."letterId",
        l."year",
        s."order",
        s."title",
        s."contentEn",
        s."contentZh",
        1 - (s."embedding" <=> $1::vector) AS vector_score
      FROM "Chunk" s
      JOIN "Letter" l ON l."id" = s."letterId"
      WHERE s."embedding" IS NOT NULL
      ORDER BY s."embedding" <=> $1::vector
      LIMIT 20
    ),
    keyword_search AS (
      SELECT
        s."id",
        s."letterId",
        l."year",
        s."order",
        s."title",
        s."contentEn",
        s."contentZh",
        ts_rank_cd(s."searchVector", plainto_tsquery('english', $2)) AS keyword_score
      FROM "Chunk" s
      JOIN "Letter" l ON l."id" = s."letterId"
      WHERE s."searchVector" @@ plainto_tsquery('english', $2)
      ORDER BY keyword_score DESC
      LIMIT 20
    )
    SELECT
      COALESCE(v."id", k."id") AS "id",
      COALESCE(v."letterId", k."letterId") AS "letterId",
      COALESCE(v."year", k."year") AS "year",
      COALESCE(v."order", k."order") AS "order",
      COALESCE(v."title", k."title") AS "title",
      COALESCE(v."contentEn", k."contentEn") AS "contentEn",
      COALESCE(v."contentZh", k."contentZh") AS "contentZh",
      COALESCE(v.vector_score, 0) AS "vectorScore",
      COALESCE(k.keyword_score, 0) AS "keywordScore",
      (${VECTOR_WEIGHT} * COALESCE(v.vector_score, 0)
       + ${KEYWORD_WEIGHT} * COALESCE(k.keyword_score, 0)) AS "finalScore"
    FROM vector_search v
    FULL OUTER JOIN keyword_search k ON v."id" = k."id"
    ORDER BY "finalScore" DESC
    LIMIT $3
    `,
    JSON.stringify(queryEmbedding),
    translatedQuery,
    limit,
  );

  return results.map((r) => ({
    id: r.id,
    year: r.year,
    order: r.order,
    title: r.title,
    contentEn: r.contentEn,
    contentZh: r.contentZh,
    score: r.finalScore,
  }));
}

// ── Main entry point ─────────────────────────────────────────────────────

export async function searchChunks(query: string): Promise<RetrievedChunk[]> {
  // Step 1: Translate query to English (for both tsvector and embedding)
  const translatedQuery = await translateQuery(query);

  // Step 2: Get query embedding
  let queryEmbedding: number[];
  try {
    queryEmbedding = await getEmbedding(translatedQuery);
  } catch (err) {
    console.error("Embedding failed, falling back to keyword-only:", err);
    return keywordOnlyFallback(translatedQuery);
  }

  // Step 3: Hybrid search
  return hybridSearch(translatedQuery, queryEmbedding);
}

// ── Fallback: keyword-only search (if embedding API is down) ─────────────

async function keywordOnlyFallback(query: string): Promise<RetrievedChunk[]> {
  const results = await prisma.$queryRawUnsafe<
    { id: string; year: number; order: number; title: string | null; contentEn: string; contentZh: string | null; score: number }[]
  >(
    `
    SELECT
      s."id",
      l."year",
      s."order",
      s."title",
      s."contentEn",
      s."contentZh",
      ts_rank_cd(s."searchVector", plainto_tsquery('english', $1)) AS score
    FROM "Chunk" s
    JOIN "Letter" l ON l."id" = s."letterId"
    WHERE s."searchVector" @@ plainto_tsquery('english', $1)
    ORDER BY score DESC
    LIMIT 5
    `,
    query,
  );

  return results;
}
