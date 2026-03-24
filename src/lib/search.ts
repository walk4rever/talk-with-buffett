/**
 * Retrieval pipeline for the chat engine.
 *
 * MVP flow:
 *   understandQuery(query) -> lightweight query plan (task + time + queries)
 *   parallel retrieval (keyword + semantic) with task-aware budgets
 *   RRF fusion + hard year filter + lightweight task post-process
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
type TaskType = "fact" | "method" | "chat";
type TemporalMode = "none" | "point" | "range" | "earliest" | "latest" | "evolution";

interface QueryPlan {
  taskType: TaskType;
  timeline: boolean;
  compare: boolean;
  temporalMode: TemporalMode;
  entities: string[];
  yearFrom: number | null;
  yearTo: number | null;
  keywordQuery: string;
  semanticQuery: string;
  confidence: number;
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
  return /(哪一年|哪年|哪些年|几年|最早|首次|第一次|历年|变化|when did|what year|which year|first mention|earliest|latest|over\s+time)/i.test(text);
}

function isMentionQuery(text: string): boolean {
  return /(提到|提及|有没有说过|mention|mentioned|mentioning)/i.test(text);
}

function isCompareQuestion(text: string): boolean {
  return /(比较|对比|区别|vs\.?|versus|相比|compared?\s+to)/i.test(text);
}

function isMethodQuestion(text: string): boolean {
  return /(怎么看|看法|认为|原则|方法|如何|怎么做|approach|philosophy|principle|framework|why)/i.test(text);
}

function isChatQuestion(text: string): boolean {
  const q = text.trim();
  if (q.length <= 12 && /^(你好|嗨|哈喽|在吗|谢谢|hello|hi)/i.test(q)) return true;
  return /(你好吗|讲个笑话|早上好|晚上好)/i.test(q);
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
  "You are a retrieval planner for Warren Buffett corpus QA.\\n" +
  "Return strict JSON only with keys: task_type, temporal_mode, year_from, year_to, entities, keyword_query, semantic_query, confidence.\\n" +
  "task_type enum: fact|method|chat.\\n" +
  "temporal_mode enum: none|point|range|earliest|latest|evolution.\\n" +
  "entities must be a short array of retrieval-relevant names.\\n" +
  "Translate Chinese into concise English retrieval expressions.\\n" +
  "keyword_query should prioritize exact entities and anchor terms; semantic_query should be a natural English query.\\n" +
  "If no year constraints, use null for year_from/year_to.\\n" +
  "Output only one JSON object.";

function extractYearsFromText(text: string): { yearFrom: number | null; yearTo: number | null } {
  const years = Array.from(text.matchAll(/(?:19|20)\d{2}/g)).map((m) => Number(m[0]));
  if (years.length === 0) return { yearFrom: null, yearTo: null };
  const sorted = [...years].sort((a, b) => a - b);
  return { yearFrom: sorted[0] ?? null, yearTo: sorted[sorted.length - 1] ?? null };
}

function inferTemporalMode(text: string, yearFrom: number | null, yearTo: number | null): TemporalMode {
  if (/(最早|首次|第一次|earliest|first)/i.test(text)) return "earliest";
  if (/(最近|最新|latest|most recent)/i.test(text)) return "latest";
  if (/(变化|演变|历年|evolution|over\s+time)/i.test(text)) return "evolution";
  if (yearFrom !== null && yearTo !== null && yearFrom !== yearTo) return "range";
  if (yearFrom !== null && yearTo !== null && yearFrom === yearTo) return "point";
  return "none";
}

function normalizeYearRange(yearFrom: number | null, yearTo: number | null): { yearFrom: number | null; yearTo: number | null } {
  const yf = yearFrom !== null && yearFrom >= 1900 && yearFrom <= 2100 ? yearFrom : null;
  const yt = yearTo !== null && yearTo >= 1900 && yearTo <= 2100 ? yearTo : null;
  if (yf === null && yt === null) return { yearFrom: null, yearTo: null };
  if (yf !== null && yt !== null && yf > yt) return { yearFrom: yt, yearTo: yf };
  return { yearFrom: yf, yearTo: yt };
}

function fallbackPlan(query: string): QueryPlan {
  const normalizedInput = applyGlossary(query);
  const extractedYears = extractYearsFromText(normalizedInput);
  const { yearFrom, yearTo } = normalizeYearRange(extractedYears.yearFrom, extractedYears.yearTo);
  const compare = isCompareQuestion(normalizedInput);
  const timeline = isTemporalQuestion(normalizedInput);
  const taskType: TaskType = isChatQuestion(normalizedInput)
    ? "chat"
    : isMethodQuestion(normalizedInput)
    ? "method"
    : "fact";

  return {
    taskType: compare && taskType === "chat" ? "fact" : taskType,
    timeline,
    compare,
    temporalMode: inferTemporalMode(normalizedInput, yearFrom, yearTo),
    entities: [],
    yearFrom,
    yearTo,
    keywordQuery: normalizedInput,
    semanticQuery: normalizedInput,
    confidence: 0.55,
  };
}

function normalizePlan(raw: unknown, fallback: QueryPlan): QueryPlan {
  if (!raw || typeof raw !== "object") return fallback;
  const obj = raw as Record<string, unknown>;

  const taskType = ["fact", "method", "chat"].includes(String(obj.task_type))
    ? (obj.task_type as TaskType)
    : fallback.taskType;
  const temporalMode = ["none", "point", "range", "earliest", "latest", "evolution"].includes(String(obj.temporal_mode))
    ? (obj.temporal_mode as TemporalMode)
    : fallback.temporalMode;

  const entities = Array.isArray(obj.entities)
    ? obj.entities.map((x) => String(x).trim()).filter((x) => x.length > 0).slice(0, 8)
    : fallback.entities;

  const yearFromRaw = typeof obj.year_from === "number" ? obj.year_from : fallback.yearFrom;
  const yearToRaw = typeof obj.year_to === "number" ? obj.year_to : fallback.yearTo;
  const { yearFrom, yearTo } = normalizeYearRange(yearFromRaw, yearToRaw);

  const keywordQuery = String(obj.keyword_query ?? "").trim() || fallback.keywordQuery;
  const semanticQuery = String(obj.semantic_query ?? "").trim() || fallback.semanticQuery;
  const confidence = typeof obj.confidence === "number" && obj.confidence >= 0 && obj.confidence <= 1
    ? obj.confidence
    : fallback.confidence;

  const compare = isCompareQuestion(keywordQuery) || isCompareQuestion(semanticQuery);
  const timeline = temporalMode !== "none" || isTemporalQuestion(keywordQuery) || isTemporalQuestion(semanticQuery);

  return {
    taskType: compare && taskType === "chat" ? "fact" : taskType,
    timeline,
    compare,
    temporalMode,
    entities,
    yearFrom,
    yearTo,
    keywordQuery,
    semanticQuery,
    confidence,
  };
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

async function understandQuery(query: string): Promise<QueryPlan> {
  const normalizedInput = applyGlossary(query);
  const fallback = fallbackPlan(normalizedInput);

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
    const normalized = normalizePlan(parsed, fallback);

    const forcedTimeline = isTemporalQuestion(query);
    const forcedCompare = isCompareQuestion(query);
    const result: QueryPlan = {
      ...normalized,
      timeline: normalized.timeline || forcedTimeline,
      compare: normalized.compare || forcedCompare,
      temporalMode: forcedTimeline && normalized.temporalMode === "none" ? "evolution" : normalized.temporalMode,
    };

    console.log(
      `[understandQuery] task=${result.taskType} timeline=${result.timeline} compare=${result.compare} mode=${result.temporalMode} years=${result.yearFrom ?? "-"}-${result.yearTo ?? "-"} conf=${result.confidence.toFixed(2)}`,
    );
    return result;
  } catch (err) {
    console.error("[understandQuery] error:", err);
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
    if (/^[a-z0-9_-]+$/i.test(t)) {
      const re = new RegExp(`\\b${escapeRegExp(t)}\\b`, "i");
      return re.test(text);
    }
    return text.toLowerCase().includes(t.toLowerCase());
  });
}

const STRICT_TOKEN_STOPWORDS = new Set([
  "the", "and", "for", "with", "what", "when", "which", "who", "whom", "where", "why", "how",
  "did", "does", "have", "has", "about", "into", "from", "that", "this", "your", "you", "will",
  "were", "been", "over", "time", "first", "earliest", "latest", "mention", "mentioned",
]);

function extractAsciiTokens(text: string): string[] {
  const out: string[] = [];
  const matches = text.match(/[A-Za-z][A-Za-z0-9.&'-]*/g) ?? [];
  for (const raw of matches) {
    const token = raw.trim().replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (token.length < 2) continue;
    if (STRICT_TOKEN_STOPWORDS.has(token.toLowerCase())) continue;
    out.push(token);
  }
  return [...new Set(out)];
}

function buildStrictTokens(keywordQuery: string, entities: string[], rawQuery: string): string[] {
  const fromKeyword = extractAsciiTokens(primaryTerm(keywordQuery));
  const fromEntities = entities.flatMap((e) => extractAsciiTokens(e));
  const fromRaw = extractAsciiTokens(rawQuery).filter((t) => t.toUpperCase() === t || t.length >= 4);
  return [...new Set([...fromEntities, ...fromKeyword, ...fromRaw])].slice(0, 8);
}

const KEYWORD_ANCHORS: Array<{ pattern: RegExp; anchor: string }> = [
  { pattern: /能力圈|circle of competence/i, anchor: "circle of competence" },
  { pattern: /护城河|moat/i, anchor: "economic moat" },
  { pattern: /择时|market timing/i, anchor: "market timing" },
  { pattern: /科技公司|technology company|tech company|tech stock/i, anchor: "technology companies investment" },
  { pattern: /苹果|apple/i, anchor: "Apple AAPL" },
  { pattern: /可口可乐|coca[\s-]?cola/i, anchor: "Coca-Cola" },
  { pattern: /继任|接班|succession/i, anchor: "succession" },
  { pattern: /浮存金|insurance float|float/i, anchor: "insurance float" },
];

function enrichKeywordQuery(keywordQuery: string, rawQuery: string): string {
  const base = keywordQuery.trim();
  if (!base) return base;

  const anchors: string[] = [];
  for (const rule of KEYWORD_ANCHORS) {
    rule.pattern.lastIndex = 0;
    if (!rule.pattern.test(rawQuery)) continue;
    if (new RegExp(escapeRegExp(rule.anchor), "i").test(base)) continue;
    anchors.push(rule.anchor);
  }
  if (anchors.length === 0) return base;
  return `${anchors.join(" | ")} | ${base}`;
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
          ? ilikeRows.filter((r) => containsAllTokens(r.contentEn, p.strictTokens))
          : ilikeRows;
        if (strictFiltered.length > 0) return strictFiltered.map(toChunk);
      }

      if (p.strictTokens && p.strictTokens.length > 1) return [];

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
        ? rows.filter((r) => containsAllTokens(r.contentEn, p.strictTokens))
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
      ? rows.filter((r) => containsAllTokens(r.contentEn, p.strictTokens))
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

async function runSemanticSearch(
  query: string,
  limit: number,
  yearFrom: number | null,
  yearTo: number | null,
): Promise<RetrievedChunk[]> {
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
        AND ($2::int IS NULL OR l."year" >= $2)
        AND ($3::int IS NULL OR l."year" <= $3)
      ORDER BY s."embedding" <=> $1::vector
      LIMIT $4
      `,
      JSON.stringify(embedding),
      yearFrom ?? null,
      yearTo ?? null,
      limit,
    );
    return rows.map(toChunk);
  } catch (err) {
    console.error("runSemanticSearch error:", err);
    return [];
  }
}

function fuseByRrf(
  keyword: RetrievedChunk[],
  semantic: RetrievedChunk[],
  limit: number,
  weights: { keyword: number; semantic: number } = { keyword: 1, semantic: 1 },
): RetrievedChunk[] {
  const k = 50;
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

function applyYearRangeFilter(chunks: RetrievedChunk[], yearFrom: number | null, yearTo: number | null): RetrievedChunk[] {
  return chunks.filter((c) => {
    if (yearFrom !== null && c.year < yearFrom) return false;
    if (yearTo !== null && c.year > yearTo) return false;
    return true;
  });
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

function hasEntityMatch(chunk: RetrievedChunk, entity: string): boolean {
  const q = entity.trim();
  if (!q) return false;
  const text = `${chunk.title ?? ""}\n${chunk.contentEn}`.toLowerCase();
  return text.includes(q.toLowerCase());
}

async function ensureCompareCoverage(params: {
  chunks: RetrievedChunk[];
  entities: string[];
  yearFrom: number | null;
  yearTo: number | null;
}): Promise<RetrievedChunk[]> {
  if (params.entities.length < 2) return params.chunks;
  const left = params.entities[0] ?? "";
  const right = params.entities[1] ?? "";
  if (!left || !right) return params.chunks;

  const hasLeft = params.chunks.some((c) => hasEntityMatch(c, left));
  const hasRight = params.chunks.some((c) => hasEntityMatch(c, right));
  if (hasLeft && hasRight) return params.chunks;

  const missing = !hasLeft ? left : right;
  const supplementalRows = await runKeywordSearch({
    keywords: missing,
    order: "relevance",
    distinctByYear: false,
    yearFrom: params.yearFrom,
    yearTo: params.yearTo,
    limit: 8,
    strictTokens: missing.split(/\s+/).map((x) => x.trim()).filter((x) => x.length >= 3),
  });

  const uniq = new Map<string, RetrievedChunk>();
  for (const c of [...params.chunks, ...supplementalRows]) {
    const prev = uniq.get(c.id);
    if (!prev || c.score > prev.score) uniq.set(c.id, c);
  }
  return [...uniq.values()];
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

function mapPlanToOutput(taskType: TaskType, timeline: boolean, compare: boolean): { intent: QueryIntent; answerMode: AnswerMode } {
  if (compare) return { intent: "compare", answerMode: "compare" };
  if (timeline) return { intent: "timeline", answerMode: "timeline" };
  if (taskType === "method") return { intent: "opinion", answerMode: "concise" };
  if (taskType === "chat") return { intent: "chat", answerMode: "concise" };
  return { intent: "fact", answerMode: "concise" };
}

function buildRrfWeights(taskType: TaskType, timeline: boolean, compare: boolean): { keyword: number; semantic: number } {
  if (compare) return { keyword: 0.5, semantic: 0.5 };
  if (timeline) return { keyword: 0.6, semantic: 0.4 };
  if (taskType === "method") return { keyword: 0.45, semantic: 0.55 };
  if (taskType === "chat") return { keyword: 1, semantic: 0 };
  return { keyword: 0.7, semantic: 0.3 };
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
  const timelineQuery = u.timeline || isTemporalQuestion(query);
  const compareQuery = u.compare || isCompareQuestion(query);

  const order: "asc" | "desc" | "relevance" = timelineQuery ? "asc" : "relevance";
  const distinctByYear = timelineQuery;

  let keywordLimit = u.taskType === "fact" ? 32 : u.taskType === "method" ? 24 : 6;
  let semanticLimit = u.taskType === "fact" ? 16 : u.taskType === "method" ? 24 : 0;
  if (timelineQuery) {
    keywordLimit += 8;
    semanticLimit += 8;
  }
  if (mentionQuery && timelineQuery) {
    semanticLimit = 0;
  }

  const refinedKeywordQuery = mentionQuery && timelineQuery
    ? refineKeywordForEntityMention(u.keywordQuery, query)
    : u.keywordQuery;
  const keywordQuery = enrichKeywordQuery(refinedKeywordQuery, query);
  const strictTokens = mentionQuery && timelineQuery
    ? buildStrictTokens(keywordQuery, u.entities, query)
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
    semanticLimit > 0
      ? runSemanticSearch(u.semanticQuery, semanticLimit, u.yearFrom, u.yearTo)
      : Promise.resolve([]),
  ]);

  const weights = buildRrfWeights(u.taskType, timelineQuery, compareQuery);
  let fused = fuseByRrf(keywordRows, semanticRows, distinctByYear ? 24 : 10, weights);
  fused = applyYearRangeFilter(fused, u.yearFrom, u.yearTo);

  if (fused.length === 0) {
    const fallbackRows = await runKeywordSearch({
      keywords: query,
      order: "relevance",
      distinctByYear: false,
      yearFrom: u.yearFrom,
      yearTo: u.yearTo,
      limit: 10,
      strictTokens: [],
    });
    fused = applyYearRangeFilter(fallbackRows, u.yearFrom, u.yearTo);
  }

  if (compareQuery) {
    fused = await ensureCompareCoverage({
      chunks: fused,
      entities: u.entities,
      yearFrom: u.yearFrom,
      yearTo: u.yearTo,
    });
  }

  const deduped = maybeDistinctByYear(fused, distinctByYear);
  const finalChunks = sortForOrder(deduped, order);
  const { intent, answerMode } = mapPlanToOutput(u.taskType, timelineQuery, compareQuery);

  console.log(
    `[searchChunks] task=${u.taskType} intent=${intent} mode=${answerMode} timeline=${timelineQuery} compare=${compareQuery} years=${u.yearFrom ?? "-"}-${u.yearTo ?? "-"} sourceTypes=${CHAT_SOURCE_TYPES.join(",")} kw=${keywordRows.length} sem=${semanticRows.length} final=${finalChunks.length}`,
  );

  return {
    chunks: finalChunks,
    order,
    distinctByYear,
    evidenceQuery: u.keywordQuery || u.semanticQuery || query,
    intent,
    answerMode,
    entities: u.entities,
    yearFrom: u.yearFrom,
    yearTo: u.yearTo,
  };
}
