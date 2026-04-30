/**
 * Neo4j triplet extraction — LLM-based entity + relationship extraction
 *
 * For each chunk, calls doubao to extract:
 *   - Concepts (moat, float, intrinsic_value …)
 *   - Companies (See's Candies, Coca-Cola …)
 *   - Persons (Charlie Munger, Tom Murphy …)
 *   - Concept→Concept relations (moat requires pricing_power …)
 *
 * Then writes all extracted nodes + relationships to Neo4j.
 *
 * Usage:
 *   # Test: one letter by year
 *   node --env-file=.env.local ./node_modules/.bin/ts-node --esm \
 *     scripts/neo4j-extract-triplets.ts --year 1989
 *
 *   # Full run by source type
 *   node --env-file=.env.local ./node_modules/.bin/ts-node --esm \
 *     scripts/neo4j-extract-triplets.ts --type shareholder
 */

import neo4j, { type Session } from "neo4j-driver";
import { PrismaClient } from "@prisma/client";

// ── Types ─────────────────────────────────────────────────────────────────────

type Sentiment = "bullish" | "neutral" | "cautious" | "critical";
type CompanyAction = "buy" | "sell" | "hold" | "praise" | "criticize" | "mention";
type ConceptRelationType = "requires" | "enables" | "contrasts" | "part_of" | "evolves_to";

interface ExtractedConcept {
  id: string;
  name: string;
  sentiment: Sentiment;
  span: string;
}

interface ExtractedCompany {
  id: string;
  name: string;
  ticker?: string;
  sentiment: Sentiment;
  action: CompanyAction;
  span: string;
}

interface ExtractedPerson {
  id: string;
  name: string;
  span: string;
}

interface ConceptRelation {
  from: string;
  to: string;
  type: ConceptRelationType;
}

interface ExtractionResult {
  concepts: ExtractedConcept[];
  companies: ExtractedCompany[];
  persons: ExtractedPerson[];
  concept_relations: ConceptRelation[];
}

// ── Env helpers ───────────────────────────────────────────────────────────────

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[extract] Missing env var: ${name}`);
  return v;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let year: number | null = null;
  let yearFrom: number | null = null;
  let yearTo: number | null = null;
  let sourceType = "shareholder";
  let batchSize = 10;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--year" && args[i + 1])  year     = Number(args[++i]);
    else if (args[i] === "--from" && args[i + 1]) yearFrom = Number(args[++i]);
    else if (args[i] === "--to"   && args[i + 1]) yearTo   = Number(args[++i]);
    else if (args[i] === "--type" && args[i + 1]) sourceType = args[++i] ?? sourceType;
    else if (args[i] === "--batch" && args[i + 1]) batchSize = Number(args[++i]);
    else if (args[i] === "--dry-run") dryRun = true;
  }

  // --year is shorthand for --from X --to X
  if (year !== null) { yearFrom = year; yearTo = year; }

  return { yearFrom, yearTo, sourceType, batchSize, dryRun };
}

// ── LLM extraction ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert analyst extracting structured knowledge from Warren Buffett's letters and speeches.

For each passage, extract:
1. Investment CONCEPTS mentioned (e.g., moat, float, intrinsic_value, margin_of_safety, capital_allocation)
2. COMPANIES mentioned (e.g., See's Candies, Coca-Cola, GEICO, Apple)
3. PERSONS mentioned other than Buffett himself (e.g., Charlie Munger, Tom Murphy)
4. Explicit CONCEPT→CONCEPT relationships stated in the text

Rules:
- Only extract entities clearly present in the text. Do not infer.
- ids must be snake_case, lowercase, max 40 chars.
- span: the exact short phrase (≤80 chars) that triggered the extraction.
- sentiment: bullish=positive view, neutral=factual mention, cautious=concern, critical=negative.
- For companies: action = buy/sell/hold/praise/criticize/mention.
- concept_relations: only include if the relationship is explicitly stated.
- If nothing meaningful to extract, return empty arrays.

Respond ONLY with valid JSON matching this schema:
{
  "concepts": [{"id": string, "name": string, "sentiment": string, "span": string}],
  "companies": [{"id": string, "name": string, "ticker": string|null, "sentiment": string, "action": string, "span": string}],
  "persons":   [{"id": string, "name": string, "span": string}],
  "concept_relations": [{"from": string, "to": string, "type": string}]
}`;

async function extractTriplets(
  text: string,
  apiKey: string,
  apiBase: string,
  model: string,
): Promise<ExtractionResult | null> {
  try {
    const res = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text.slice(0, 1200) },
        ],
        temperature: 0,
        max_tokens: 1000,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      console.warn(`[extract] LLM error ${res.status}`);
      return null;
    }

    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content?.trim() ?? "";

    // Strip markdown code fences if present
    const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(cleaned) as ExtractionResult;
  } catch (e) {
    console.warn("[extract] parse error:", (e as Error).message);
    return null;
  }
}

// ── Neo4j writers ─────────────────────────────────────────────────────────────

async function writeToNeo4j(
  session: Session,
  investorId: string,
  chunkId: string,
  year: number,
  result: ExtractionResult,
): Promise<void> {
  const { concepts, companies, persons, concept_relations } = result;

  // Concepts + MENTIONS_CONCEPT
  for (const c of concepts) {
    if (!c.id || !c.name) continue;
    await session.run(
      `MERGE (con:Concept {id: $id})
       SET con.name = $name
       WITH con
       MATCH (p:Paragraph {id: $chunkId})
       MERGE (p)-[r:MENTIONS_CONCEPT]->(con)
       SET r.sentiment = $sentiment, r.span = $span, r.year = $year`,
      { id: c.id, name: c.name, chunkId, sentiment: c.sentiment, span: c.span, year },
    );
    // Aggregate investor view
    await session.run(
      `MATCH (i:Investor {id: $investorId}), (con:Concept {id: $conceptId})
       MERGE (i)-[r:HOLDS_VIEW]->(con)
       SET r.yearFirst = CASE WHEN r.yearFirst IS NULL OR $year < r.yearFirst THEN $year ELSE r.yearFirst END,
           r.yearLast  = CASE WHEN r.yearLast  IS NULL OR $year > r.yearLast  THEN $year ELSE r.yearLast  END`,
      { investorId, conceptId: c.id, year },
    );
  }

  // Companies + MENTIONS_COMPANY
  for (const co of companies) {
    if (!co.id || !co.name) continue;
    await session.run(
      `MERGE (com:Company {id: $id})
       SET com.name = $name
       WITH com
       MATCH (p:Paragraph {id: $chunkId})
       MERGE (p)-[r:MENTIONS_COMPANY]->(com)
       SET r.sentiment = $sentiment, r.action = $action, r.span = $span, r.year = $year`,
      { id: co.id, name: co.name, chunkId, sentiment: co.sentiment, action: co.action, span: co.span, year },
    );
    if (co.ticker) {
      await session.run(`MATCH (com:Company {id: $id}) SET com.ticker = $ticker`, { id: co.id, ticker: co.ticker });
    }
  }

  // Persons + MENTIONS_PERSON
  for (const per of persons) {
    if (!per.id || !per.name) continue;
    await session.run(
      `MERGE (pn:Person {id: $id})
       SET pn.name = $name
       WITH pn
       MATCH (p:Paragraph {id: $chunkId})
       MERGE (p)-[r:MENTIONS_PERSON]->(pn)
       SET r.span = $span, r.year = $year`,
      { id: per.id, name: per.name, chunkId, span: per.span, year },
    );
  }

  // Concept→Concept relations
  for (const rel of concept_relations) {
    if (!rel.from || !rel.to) continue;
    await session.run(
      `MERGE (a:Concept {id: $from})
       MERGE (b:Concept {id: $to})
       MERGE (a)-[r:RELATES_TO {type: $type}]->(b)`,
      { from: rel.from, to: rel.to, type: rel.type },
    );
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { yearFrom, yearTo, sourceType, dryRun } = parseArgs();

  const apiKey  = required("AI_API_KEY");
  const apiBase = required("AI_API_BASE_URL");
  const model   = required("AI_MODEL");

  const prisma = process.env.DIRECT_URL
    ? new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } })
    : new PrismaClient();

  const driver = neo4j.driver(
    required("NEO4J_URI"),
    neo4j.auth.basic(required("NEO4J_USERNAME"), required("NEO4J_PASSWORD")),
    { disableLosslessIntegers: true },
  );
  const session = driver.session();

  try {
    // Load sources
    const yearFilter = yearFrom !== null || yearTo !== null
      ? { gte: yearFrom ?? undefined, lte: yearTo ?? undefined }
      : undefined;

    const where = {
      type: sourceType,
      ...(yearFilter ? { year: yearFilter } : {}),
    };
    const sources = await prisma.source.findMany({
      where,
      orderBy: { year: "asc" },
      include: {
        chunks: {
          where: { contentEn: { not: "" } },
          orderBy: { order: "asc" },
          select: { id: true, order: true, title: true, contentEn: true },
        },
      },
    });

    if (sources.length === 0) {
      const rangeStr = yearFrom || yearTo ? ` ${yearFrom ?? ""}–${yearTo ?? ""}` : "";
      console.log(`[extract] No sources found for type=${sourceType}${rangeStr}`);
      return;
    }

    console.log(`[extract] Found ${sources.length} source(s), dry-run=${dryRun}`);

    let totalChunks = 0;
    let extracted = 0;
    let skipped = 0;
    let errors = 0;

    for (const source of sources) {
      const docId = `${source.type}_${source.year}_${source.id}`;

      // Ensure Document node
      if (!dryRun) {
        await session.run(
          `MERGE (d:Document {id: $id})
           SET d.year = $year, d.type = $type, d.title = $title, d.sourceId = $sourceId
           WITH d
           MATCH (i:Investor {id: "buffett"})
           MERGE (i)-[:WROTE]->(d)`,
          { id: docId, year: source.year, type: source.type, title: source.title, sourceId: source.id },
        );
      }

      // Filter chunks worth processing (skip very short or table-like content)
      const chunks = source.chunks.filter((c) => {
        const text = c.contentEn?.trim() ?? "";
        return text.length > 80 && !text.startsWith("|");
      });

      console.log(`\n[extract] ${source.year} ${source.type}: ${chunks.length}/${source.chunks.length} chunks`);

      // Process chunks sequentially (Neo4j session doesn't support concurrent queries)
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        totalChunks++;

        // Skip already-processed chunks (idempotency)
        if (!dryRun) {
          const existing = await session.run(
            `MATCH (p:Paragraph {id: $id})-[:MENTIONS_CONCEPT|MENTIONS_COMPANY]->() RETURN count(*) AS n`,
            { id: chunk.id },
          );
          if ((existing.records[0]?.get("n") ?? 0) > 0) {
            skipped++;
            process.stdout.write(`  [${i + 1}/${chunks.length}] skip ${chunk.order}\r`);
            continue;
          }
        }

        // Ensure Paragraph node
        if (!dryRun) {
          await session.run(
            `MERGE (p:Paragraph {id: $id})
             SET p.order = $order, p.title = $title, p.year = $year, p.chunkId = $id
             WITH p
             MATCH (d:Document {id: $docId})
             MERGE (d)-[:CONTAINS]->(p)`,
            { id: chunk.id, order: chunk.order, title: chunk.title ?? null, year: source.year, docId },
          );
        }

        const result = await extractTriplets(chunk.contentEn, apiKey, apiBase, model);

        if (!result) {
          errors++;
          continue;
        }

        const total = result.concepts.length + result.companies.length + result.persons.length;
        if (total === 0) {
          skipped++;
          continue;
        }

        if (dryRun) {
          console.log(`  chunk ${chunk.order}: ${total} entities`, JSON.stringify(result, null, 2).slice(0, 200));
        } else {
          await writeToNeo4j(session, "buffett", chunk.id, source.year, result);
        }
        extracted++;

        process.stdout.write(`  [${i + 1}/${chunks.length}] chunk ${chunk.order} → ${total} entities\r`);
      }
    }

    console.log(`\n[extract] Done — total=${totalChunks} extracted=${extracted} skipped=${skipped} errors=${errors}`);

    if (!dryRun) {
      const nodes = await session.run("MATCH (n) RETURN count(n) AS n");
      const rels  = await session.run("MATCH ()-[r]->() RETURN count(r) AS r");
      console.log(`[extract] Neo4j: nodes=${nodes.records[0]?.get("n")} rels=${rels.records[0]?.get("r")}`);
    }
  } finally {
    await session.close();
    await driver.close();
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
