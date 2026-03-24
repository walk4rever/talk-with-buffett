/**
 * Retrieval pipeline for the chat engine.
 *
 * Flow:
 *   understandQuery(query) -> structured intent/entities/time/queries
 *   parallel retrieval (keyword + semantic) within configured source scope
 *   fuse + rank -> return top chunks for prompt grounding
 */

import prisma from "@/lib/prisma";
import type { RetrievedChunk } from "@/lib/prompts/buffett";

const AI_API_KEY = process.env.AI_API_KEY!;
const AI_API_BASE_URL = process.env.AI_API_BASE_URL!;
const AI_MODEL = process.env.AI_MODEL!;

const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY ?? AI_API_KEY;
const EMBEDDING_API_BASE_URL = process.env.EMBEDDING_API_BASE_URL ?? AI_API_BASE_URL;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "doubao-embedding-large";

const ALLOWED_SOURCE_TYPES = ["shareholder", "partnership", "annual_meeting", "article", "interview"] as const;
type SourceType = (typeof ALLOWED_SOURCE_TYPES)[number];

const DEFAULT_CHAT_SOURCE_TYPES: SourceType[] = ["shareholder", "partnership"];

function resolveChatSourceTypes(): SourceType[] {
  const raw = process.env.CHAT_SOURCE_TYPES;
  if (!raw) return DEFAULT_CHAT_SOURCE_TYPES;

  const parsed = raw
    .split(",")
    .map((x) => x.trim())
    .filter((x): x is SourceType => (ALLOWED_SOURCE_TYPES as readonly string[]).includes(x));

  return parsed.length > 0 ? parsed : DEFAULT_CHAT_SOURCE_TYPES;
}

const CHAT_SOURCE_TYPES = resolveChatSourceTypes();

function sourceTypeSqlList(sourceTypes: SourceType[]): string {
  return sourceTypes.map((t) => `'${t}'`).join(", ");
}

const CHAT_SOURCE_TYPES_SQL = sourceTypeSqlList(CHAT_SOURCE_TYPES);

type QueryIntent = "fact" | "timeline" | "opinion" | "compare" | "chat";
type AnswerMode = "concise" | "timeline" | "compare";

interface QueryUnderstanding {
  intent: QueryIntent;
  entities: string[];
  yearFrom: number | null;
  yearTo: number | null;
  keywordQuery: string;
  semanticQuery: string;
  answerMode: AnswerMode;
}

const TERM_GLOSSARY: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /前进保险|前进公司/gi, replacement: "Progressive Corporation" },
  { pattern: /伯克希尔/gi, replacement: "Berkshire Hathaway" },
];

function applyGlossary(text: string): string {
  let out = text;
  for (const item of TERM_GLOSSARY) {
    item.pattern.lastIndex = 0;
    if (!item.pattern.test(out)) continue;
    item.pattern.lastIndex = 0;
    out = out.replace(item.pattern, `${item.replacement}`);
  }
  return out;
}

function isTemporalQuestion(text: string): boolean {
  return /(哪一年|哪年|哪些年|几年|最早|首次|第一次|when did|what year|which year|first mention|earliest)/i.test(text);
}

function isMentionQuery(text: string): boolean {
  return /(提到|提及|有没有说过|mention|mentioned|mentioning)/i.test(text);
}

function refineKeywordForEntityMention(keywordQuery: string, rawQuery: string): string {
  const q = keywordQuery.trim();
  if (!q) return q;
  if (/progressive corporation/i.test(q) && !/\|/.test(q)) {
    return "Progressive Corporation | Progressive Insurance | Progressive";
  }
  if (/前进保险|Progressive/i.test(rawQuery) && !/\|/.test(q)) {
    return `Progressive Corporation | Progressive Insurance | ${q} | Progressive`;
  }
  return q;
}

const UNDERSTAND_SYSTEM =
  "You normalize user questions for retrieval over Warren Buffett writings.\n" +
  "Return strict JSON only, with keys: intent, entities, yearFrom, yearTo, keywordQuery, semanticQuery, answerMode.\n" +
  "intent enum: fact|timeline|opinion|compare|chat.\n" +
  "answerMode enum: concise|timeline|compare.\n" +
  "Translate Chinese into concise English retrieval expressions.\n" +
  "keywordQuery should prioritize entities and exact terms; semanticQuery should be a natural English query.\n" +
  "If no year constraints, use null for yearFrom/yearTo.\n" +
  "Do not add markdown. Output only one JSON object.";

function extractYearsFromText(text: string): { yearFrom: number | null; yearTo: number | null } {
  const years = Array.from(text.matchAll(/(?:19|20)\d{2}/g)).map((m) => Number(m[0]));
  if (years.length === 0) return { yearFrom: null, yearTo: null };
  const sorted = [...years].sort((a, b) => a - b);
  return { yearFrom: sorted[0] ?? null, yearTo: sorted[sorted.length - 1] ?? null };
}

function fallbackUnderstanding(query: string): QueryUnderstanding {
  const normalizedInput = applyGlossary(query);
  const temporalPattern = /(哪年|哪些年|首次|第一次|历年|变化|most recent|latest|first\s+time|which\s+years|over\s+time)/i;
  const opinionPattern = /(怎么看|看法|认为|原则|方法|approach|think about|philosophy|principle|framework)/i;
  const comparePattern = /(比较|对比|区别|vs\.?|versus|compared?\s+to)/i;

  const { yearFrom, yearTo } = extractYearsFromText(normalizedInput);
  const intent: QueryIntent = comparePattern.test(normalizedInput)
    ? "compare"
    : temporalPattern.test(normalizedInput)
    ? "timeline"
    : opinionPattern.test(normalizedInput)
    ? "opinion"
    : "fact";

  const answerMode: AnswerMode = intent === "timeline" ? "timeline" : intent === "compare" ? "compare" : "concise";

  return {
    intent,
    entities: [],
    yearFrom,
    yearTo,
    keywordQuery: normalizedInput,
    semanticQuery: normalizedInput,
    answerMode,
  };
}

function normalizeUnderstanding(raw: unknown, fallback: QueryUnderstanding): QueryUnderstanding {
  if (!raw || typeof raw !== "object") return fallback;
  const obj = raw as Record<string, unknown>;

  const intent = ["fact", "timeline", "opinion", "compare", "chat"].includes(String(obj.intent))
    ? (obj.intent as QueryIntent)
    : fallback.intent;

  const answerMode = ["concise", "timeline", "compare"].includes(String(obj.answerMode))
    ? (obj.answerMode as AnswerMode)
    : fallback.answerMode;

  const entities = Array.isArray(obj.entities)
    ? obj.entities.map((x) => String(x).trim()).filter((x) => x.length > 0).slice(0, 8)
    : fallback.entities;

  const yearFrom = typeof obj.yearFrom === "number" ? obj.yearFrom : fallback.yearFrom;
  const yearTo = typeof obj.yearTo === "number" ? obj.yearTo : fallback.yearTo;

  const keywordQuery = String(obj.keywordQuery ?? "").trim() || fallback.keywordQuery;
  const semanticQuery = String(obj.semanticQuery ?? "").trim() || fallback.semanticQuery;

  return { intent, entities, yearFrom, yearTo, keywordQuery, semanticQuery, answerMode };
}

function tryParseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function understandQuery(query: string): Promise<QueryUnderstanding> {
  const normalizedInput = applyGlossary(query);
  const fallback = fallbackUnderstanding(normalizedInput);

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
          { role: "system", content: UNDERSTAND_SYSTEM },
          { role: "user", content: normalizedInput },
        ],
        temperature: 0,
        max_tokens: 260,
      }),
    });

    if (!res.ok) throw new Error(`API ${res.status}`);

    const data = await res.json();
    const content = String(data.choices?.[0]?.message?.content ?? "");
    const parsed = tryParseJson(content);
    const normalized = normalizeUnderstanding(parsed, fallback);

    console.log(`[understandQuery] ${JSON.stringify(normalized)}`);
    if (isTemporalQuestion(query)) {
      return {
        ...normalized,
        intent: "timeline",
        answerMode: "timeline",
      };
    }
    return normalized;
  } catch (err) {
    console.error("[understandQuery] error:", err);
    if (isTemporalQuestion(query)) {
      return {
        ...fallback,
        intent: "timeline",
        answerMode: "timeline",
      };
    }
    return fallback;
  }
}

// Lower threshold for temporal queries to improve long-tail recall.
const THRESHOLD_TEMPORAL = 0.001;
const THRESHOLD_RELEVANCE = 0.05;

interface KeywordParams {
  keywords: string;
  order: "asc" | "desc" | "relevance";
  distinctByYear: boolean;
  yearFrom: number | null;
  yearTo: number | null;
  limit: number;
  strictTokens?: string[];
}

/** Primary search term extracted from "Foo | Foo Bar" style keywords (first token before " | "). */
function primaryTerm(keywords: string): string {
  return keywords.split("|")[0].trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsAllTokens(text: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  return tokens.every((t) => {
    // ASCII tokens: enforce whole-word match to avoid false positives like progressive -> progressively.
    if (/^[a-z0-9_-]+$/i.test(t)) {
      const re = new RegExp(`\\b${escapeRegExp(t)}\\b`, "i");
      return re.test(text);
    }
    return text.toLowerCase().includes(t.toLowerCase());
  });
}

async function runKeywordSearch(p: KeywordParams): Promise<RetrievedChunk[]> {
  const q = p.keywords.trim();
  if (!q) return [];

  const threshold = p.order === "relevance" ? THRESHOLD_RELEVANCE : THRESHOLD_TEMPORAL;
  const orderClause =
    p.order === "asc" ? `l."year" ASC, score DESC` :
    p.order === "desc" ? `l."year" DESC, score DESC` :
    `score DESC`;

  try {
    if (p.distinctByYear) {
      const term = primaryTerm(q);
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
          AND l."type" IN (${CHAT_SOURCE_TYPES_SQL})
          AND ($2::int IS NULL OR l."year" >= $2)
          AND ($3::int IS NULL OR l."year" <= $3)
        ORDER BY l."year" ASC
        LIMIT $4
        `,
        likePattern, p.yearFrom ?? null, p.yearTo ?? null, p.limit,
      );

      if (ilikeRows.length > 0) {
        const strictFiltered = (p.strictTokens && p.strictTokens.length > 0)
          ? ilikeRows.filter((r) => containsAllTokens(r.contentEn, p.strictTokens!))
          : ilikeRows;
        if (strictFiltered.length > 0) {
          return strictFiltered.map(toChunk);
        }
      }

      // Mention + temporal queries use strict phrase/entity matching only.
      // If strict filters found no rows, avoid broad tsvector fallback that introduces false positives.
      if (p.strictTokens && p.strictTokens.length > 1) {
        return [];
      }

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
          AND l."type" IN (${CHAT_SOURCE_TYPES_SQL})
          AND ($3::int IS NULL OR l."year" >= $3)
          AND ($4::int IS NULL OR l."year" <= $4)
        ORDER BY l."year" ASC, score DESC
        LIMIT $5
        `,
        q, threshold, p.yearFrom ?? null, p.yearTo ?? null, p.limit,
      );
      const strictFiltered = (p.strictTokens && p.strictTokens.length > 0)
        ? rows.filter((r) => containsAllTokens(r.contentEn, p.strictTokens!))
        : rows;
      return strictFiltered.map(toChunk);
    }

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
        AND l."type" IN (${CHAT_SOURCE_TYPES_SQL})
        AND ($3::int IS NULL OR l."year" >= $3)
        AND ($4::int IS NULL OR l."year" <= $4)
      ORDER BY ${orderClause}
      LIMIT $5
      `,
      q, threshold, p.yearFrom ?? null, p.yearTo ?? null, p.limit,
    );
    const strictFiltered = (p.strictTokens && p.strictTokens.length > 0)
      ? rows.filter((r) => containsAllTokens(r.contentEn, p.strictTokens!))
      : rows;
    return strictFiltered.map(toChunk);
  } catch (err) {
    console.error("runKeywordSearch error:", err);
    return [];
  }
}

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

async function runSemanticSearch(query: string, limit: number): Promise<RetrievedChunk[]> {
  const q = query.trim();
  if (!q) return [];

  let embedding: number[];
  try {
    embedding = await getEmbedding(q);
  } catch (err) {
    console.error("Embedding failed in runSemanticSearch:", err);
    return [];
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
        AND l."type" IN (${CHAT_SOURCE_TYPES_SQL})
      ORDER BY s."embedding" <=> $1::vector
      LIMIT $2
      `,
      JSON.stringify(embedding),
      limit,
    );
    return rows.map(toChunk);
  } catch (err) {
    console.error("runSemanticSearch error:", err);
    return [];
  }
}

function fuseByRrf(keyword: RetrievedChunk[], semantic: RetrievedChunk[], limit: number): RetrievedChunk[] {
  const k = 50;
  const weights = { keyword: 1, semantic: 1 };

  const acc = new Map<string, { chunk: RetrievedChunk; score: number }>();

  for (let i = 0; i < keyword.length; i++) {
    const c = keyword[i];
    const prev = acc.get(c.id);
    const add = weights.keyword * (1 / (k + i + 1));
    if (!prev) acc.set(c.id, { chunk: c, score: add });
    else acc.set(c.id, { chunk: prev.chunk, score: prev.score + add });
  }

  for (let i = 0; i < semantic.length; i++) {
    const c = semantic[i];
    const prev = acc.get(c.id);
    const add = weights.semantic * (1 / (k + i + 1));
    if (!prev) acc.set(c.id, { chunk: c, score: add });
    else acc.set(c.id, { chunk: prev.chunk, score: prev.score + add });
  }

  return [...acc.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.chunk);
}

function maybeDistinctByYear(chunks: RetrievedChunk[], distinctByYear: boolean): RetrievedChunk[] {
  if (!distinctByYear) return chunks;
  const seen = new Set<number>();
  const result: RetrievedChunk[] = [];
  for (const chunk of chunks) {
    if (seen.has(chunk.year)) continue;
    seen.add(chunk.year);
    result.push(chunk);
  }
  return result;
}

function sortForOrder(chunks: RetrievedChunk[], order: "asc" | "desc" | "relevance"): RetrievedChunk[] {
  if (order === "asc") return [...chunks].sort((a, b) => a.year - b.year || b.score - a.score);
  if (order === "desc") return [...chunks].sort((a, b) => b.year - a.year || b.score - a.score);
  return chunks;
}

function toChunk(r: {
  id: string; year: number; order: number; title: string | null;
  sourceType: string; contentEn: string; contentZh: string | null; score: number;
}): RetrievedChunk {
  return {
    id: r.id, year: r.year, order: r.order, title: r.title,
    sourceType: r.sourceType, contentEn: r.contentEn, contentZh: r.contentZh, score: r.score,
  };
}

export interface SearchResult {
  chunks: RetrievedChunk[];
  order: "asc" | "desc" | "relevance";
  distinctByYear: boolean;
  evidenceQuery: string;
  intent: QueryIntent;
  answerMode: AnswerMode;
  entities: string[];
  yearFrom: number | null;
  yearTo: number | null;
}

export async function searchChunks(query: string): Promise<SearchResult> {
  const u = await understandQuery(query);
  const mentionQuery = isMentionQuery(query);
  const temporalQuery = isTemporalQuestion(query);

  const isTimeline = temporalQuery || u.intent === "timeline" || u.answerMode === "timeline";
  const order: "asc" | "desc" | "relevance" = isTimeline ? "asc" : "relevance";
  const distinctByYear = isTimeline;

  const keywordLimit = distinctByYear ? 40 : 24;
  const semanticLimit = mentionQuery && temporalQuery ? 0 : 24;
  const keywordQuery = mentionQuery && temporalQuery
    ? refineKeywordForEntityMention(u.keywordQuery, query)
    : u.keywordQuery;
  const strictTokens = mentionQuery && temporalQuery
    ? primaryTerm(keywordQuery).split(/\s+/).map((x) => x.trim()).filter((x) => x.length >= 3)
    : [];

  const [keywordRows, semanticRows] = await Promise.all([
    runKeywordSearch({
      keywords: keywordQuery,
      order,
      distinctByYear,
      yearFrom: u.yearFrom,
      yearTo: u.yearTo,
      limit: keywordLimit,
      strictTokens,
    }),
    semanticLimit > 0 ? runSemanticSearch(u.semanticQuery, semanticLimit) : Promise.resolve([]),
  ]);

  let fused = fuseByRrf(keywordRows, semanticRows, distinctByYear ? 24 : 10);

  // If both retrieval routes fail unexpectedly, keep previous behavior fallback.
  if (fused.length === 0) {
    const fallbackRows = await runKeywordSearch({
      keywords: query,
      order: "relevance",
      distinctByYear: false,
      yearFrom: null,
      yearTo: null,
      limit: 10,
      strictTokens: [],
    });
    fused = fallbackRows;
  }

  const deduped = maybeDistinctByYear(fused, distinctByYear);
  const finalChunks = sortForOrder(deduped, order);

  console.log(
    `[searchChunks] intent=${u.intent} mode=${u.answerMode} sourceTypes=${CHAT_SOURCE_TYPES.join(",")} kw=${keywordRows.length} sem=${semanticRows.length} final=${finalChunks.length}`,
  );

  return {
    chunks: finalChunks,
    order,
    distinctByYear,
    evidenceQuery: u.keywordQuery || u.semanticQuery || query,
    intent: u.intent,
    answerMode: u.answerMode,
    entities: u.entities,
    yearFrom: u.yearFrom,
    yearTo: u.yearTo,
  };
}
