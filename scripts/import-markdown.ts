/**
 * Import markdown sources into the database.
 *
 * Chunking strategy: 1 EN paragraph + 1 ZH paragraph = 1 chunk (paragraph-level pairing).
 * Embeddings are computed from zh_text (cross-lingual retrieval via Chinese query).
 * Tables become skip_embedding=true chunks. Headings update section metadata only.
 *
 * Usage:
 *   npx tsx scripts/import-markdown.ts                                # all shareholder
 *   npx tsx scripts/import-markdown.ts --type annual_meeting          # all annual_meeting
 *   npx tsx scripts/import-markdown.ts --type partnership 1965        # partnership, single year
 *   npx tsx scripts/import-markdown.ts --file data/shareholder/2025_Letter_to_Berkshire_Shareholders.md
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";

// Use DIRECT_URL (bypasses pooler) for long-running scripts to avoid P1017 timeouts
const directUrl = process.env.DIRECT_URL;
const prisma = directUrl
  ? new PrismaClient({ datasources: { db: { url: directUrl } } })
  : new PrismaClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "..", "data");

const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || process.env.AI_API_KEY!;
const EMBEDDING_API_BASE_URL = process.env.EMBEDDING_API_BASE_URL || process.env.AI_API_BASE_URL!;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "doubao-embedding-large";

// ── Language detection ─────────────────────────────────────────────────────

function isZhPara(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

// ── Heading parsing ────────────────────────────────────────────────────────

/** Split a heading like "Insurance Operations 保险业务" into [en, zh]. */
function parseHeadingLangs(text: string): [string | null, string | null] {
  const idx = text.search(/[\u4e00-\u9fff]/);
  if (idx === -1) return [text.trim() || null, null];
  const en = text.slice(0, idx).trim() || null;
  const zh = text.slice(idx).trim() || null;
  return [en, zh];
}

// ── Paragraph classifiers ──────────────────────────────────────────────────

function isTable(para: string): boolean {
  return para.split("\n").filter((l) => l.trim().includes("|")).length > 1;
}

/** Lines that should not participate in EN/ZH pairing. */
function isSkippable(para: string): boolean {
  const t = para.trim();
  // English date: "February 25, 1985"
  if (/^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(t)) return true;
  // Chinese date: "1985年2月25日"
  if (/^\d{4}年\d{1,2}月\d{1,2}日$/.test(t)) return true;
  // Signature block (EN)
  if (/^Warren E\.? Buffett/i.test(t)) return true;
  if (/^Chairman\b/.test(t)) return true;
  if (/^Cordially[,，]?$/.test(t)) return true;
  // All-caps letterhead (e.g. "BUFFETT PARTNERSHIP, LTD.", "610 KIEWIT PLAZA")
  // Guard: only for pure-EN paragraphs — Chinese paragraphs with acronyms (GEICO, BPL)
  // also satisfy t === t.toUpperCase() since CJK chars have no case.
  if (!isZhPara(t) && t === t.toUpperCase() && /[A-Z]{2}/.test(t) && !t.includes("|")) return true;
  return false;
}

// ── Core chunker ───────────────────────────────────────────────────────────

interface ChunkData {
  order: number;
  title: string | null;    // sectionEn
  sectionZh: string | null;
  contentEn: string;
  contentZh: string | null;
  skipEmbedding: boolean;
}

function chunkMarkdown(md: string): ChunkData[] {
  // Normalize: remove standalone --- (horizontal rules) and collapse whitespace-only blank lines
  const normalized = md
    .replace(/^---\s*$/gm, "")
    .replace(/\n[ \t]+\n/g, "\n\n");
  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  const chunks: ChunkData[] = [];
  let sectionEn: string | null = null;
  let sectionZh: string | null = null;
  let parentEn: string | null = null;
  let parentZh: string | null = null;
  let pendingEn: string | null = null;
  let order = 0;

  function flushPending(zh: string | null = null) {
    if (!pendingEn || pendingEn.length < 20) {
      pendingEn = null;
      return;
    }
    chunks.push({
      order: ++order,
      title: sectionEn,
      sectionZh,
      contentEn: pendingEn,
      contentZh: zh || null,
      skipEmbedding: false,
    });
    pendingEn = null;
  }

  for (const para of paragraphs) {
    // Use first non-empty line for heading detection (handles --- + blank + ## patterns)
    const firstLine = para.split("\n").find((l) => l.trim()) ?? "";

    // ── Heading ──────────────────────────────────────────────────────────
    const headingMatch = firstLine.trim().match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushPending();
      const level = headingMatch[1].length;
      const [en, zh] = parseHeadingLangs(headingMatch[2]);
      if (level <= 2) {
        // H1/H2 → top-level section
        parentEn = en;
        parentZh = zh;
        sectionEn = en;
        sectionZh = zh;
      } else {
        // H3/H4 → sub-section, path = "parent > sub"
        sectionEn = parentEn && en ? `${parentEn} > ${en}` : (en ?? parentEn);
        sectionZh = parentZh && zh ? `${parentZh} > ${zh}` : (zh ?? parentZh);
      }
      continue;
    }

    // ── Table ─────────────────────────────────────────────────────────────
    if (isTable(para)) {
      flushPending();
      chunks.push({
        order: ++order,
        title: sectionEn,
        sectionZh,
        contentEn: para,
        contentZh: null,
        skipEmbedding: true,
      });
      continue;
    }

    // ── Skip ──────────────────────────────────────────────────────────────
    if (isSkippable(para)) continue;

    // ── ZH paragraph → pair with pending EN ───────────────────────────────
    if (isZhPara(para)) {
      flushPending(para);
      continue;
    }

    // ── EN paragraph → buffer ─────────────────────────────────────────────
    flushPending(); // flush any orphan EN first
    pendingEn = para;
  }

  flushPending(); // flush trailing EN
  return chunks;
}

// ── Embedding ──────────────────────────────────────────────────────────────

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

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Embedding API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.data.embedding;
}

// ── Source metadata ────────────────────────────────────────────────────────

function getSourceMeta(sourceType: string, year: number, sourceDate: string | null) {
  switch (sourceType) {
    case "annual_meeting":
      return {
        title: `${year} Berkshire Hathaway Annual Meeting`,
        url: `https://buffett.cnbc.com/${year}-berkshire-hathaway-annual-meeting/`,
      };
    case "partnership":
      return {
        title: `${year} Letter to Partners${sourceDate ? ` (${sourceDate})` : ""}`,
        url: "https://theoraclesclassroom.com/wp-content/uploads/2020/05/Buffett-Partnership-Letters-1957-1970-High-Quality.pdf",
      };
    default:
      return {
        title: `${year} Letter to Berkshire Shareholders`,
        url: `https://www.berkshirehathaway.com/letters/${year}ltr.pdf`,
      };
  }
}

// ── Import a single file ───────────────────────────────────────────────────

async function importFile(
  filePath: string,
  sourceType: string,
): Promise<{ chunks: number; embedded: number; failed: number }> {
  const file = path.basename(filePath);
  const yearMatch = file.match(/^(\d{4})/);
  if (!yearMatch) {
    console.error(`  Skipping ${file}: no year in filename`);
    return { chunks: 0, embedded: 0, failed: 0 };
  }
  const year = parseInt(yearMatch[1], 10);

  // Partnership letters: extract date from YYYYMMDD filename
  const dateMatch = file.match(/^(\d{4})(\d{2})(\d{2})?/);
  const sourceDate =
    sourceType === "partnership" && dateMatch
      ? `${dateMatch[1]}-${dateMatch[2]}${dateMatch[3] ? `-${dateMatch[3]}` : ""}`
      : null;

  const md = fs.readFileSync(filePath, "utf-8");
  const chunks = chunkMarkdown(md);
  const label = sourceDate ? `${year} (${sourceDate})` : `${year}`;
  const embeddable = chunks.filter((c) => !c.skipEmbedding && c.contentZh).length;
  console.log(`${label}: ${chunks.length} chunks, ${embeddable} to embed`);

  // Upsert Source
  const { title, url } = getSourceMeta(sourceType, year, sourceDate);
  let source = await prisma.source.findFirst({
    where: { year, type: sourceType, date: sourceDate },
  });
  if (source) {
    source = await prisma.source.update({
      where: { id: source.id },
      data: { contentMd: md },
    });
  } else {
    source = await prisma.source.create({
      data: { year, type: sourceType, date: sourceDate, title, url, contentMd: md },
    });
  }

  // Delete existing chunks (idempotent re-run)
  await prisma.$executeRawUnsafe(`DELETE FROM "Chunk" WHERE "sourceId" = $1`, source.id);

  let totalEmbedded = 0;
  let totalFailed = 0;

  for (const chunk of chunks) {
    const needsEmbedding = !chunk.skipEmbedding && !!chunk.contentZh;
    let embedding: number[] | null = null;

    if (needsEmbedding) {
      try {
        embedding = await getEmbedding(chunk.contentZh!);
        totalEmbedded++;
      } catch (err) {
        console.error(`  Failed embedding chunk ${chunk.order}: ${err}`);
        totalFailed++;
      }
    }

    if (embedding) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Chunk" ("id", "sourceId", "order", "title", "sectionZh", "contentEn", "contentZh", "skipEmbedding", "embedding", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8::vector, NOW())`,
        source.id,
        chunk.order,
        chunk.title,
        chunk.sectionZh,
        chunk.contentEn,
        chunk.contentZh,
        chunk.skipEmbedding,
        JSON.stringify(embedding),
      );
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Chunk" ("id", "sourceId", "order", "title", "sectionZh", "contentEn", "contentZh", "skipEmbedding", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, NOW())`,
        source.id,
        chunk.order,
        chunk.title,
        chunk.sectionZh,
        chunk.contentEn,
        chunk.contentZh,
        chunk.skipEmbedding,
      );
    }

    // Rate limit: 100ms between embedding calls
    if (embedding) await new Promise((r) => setTimeout(r, 100));
  }

  return { chunks: chunks.length, embedded: totalEmbedded, failed: totalFailed };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let sourceType = "shareholder";
  let yearArg: number | null = null;
  let fromYear: number | null = null;
  let singleFile: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--type" && args[i + 1]) {
      sourceType = args[++i];
    } else if (args[i] === "--file" && args[i + 1]) {
      singleFile = args[++i];
    } else if (args[i] === "--from" && args[i + 1]) {
      fromYear = parseInt(args[++i], 10);
    } else if (/^\d{4}$/.test(args[i])) {
      yearArg = parseInt(args[i], 10);
    }
  }

  if (singleFile) {
    const resolved = path.resolve(singleFile);
    if (!fs.existsSync(resolved)) {
      console.error(`File not found: ${resolved}`);
      process.exit(1);
    }
    const parentDir = path.basename(path.dirname(resolved));
    const inferredType = ["shareholder", "partnership", "annual_meeting"].includes(parentDir)
      ? parentDir
      : sourceType;

    console.log(`Importing single file: ${resolved} (type=${inferredType})\n`);
    const result = await importFile(resolved, inferredType);
    console.log(
      `\nDone: ${result.chunks} chunks, ${result.embedded} embedded, ${result.failed} failed`,
    );
  } else {
    const dir = path.join(DATA_DIR, sourceType);
    if (!fs.existsSync(dir)) {
      console.error(`Directory not found: ${dir}`);
      console.error(`Expected one of: data/shareholder, data/partnership, data/annual_meeting`);
      process.exit(1);
    }

    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md") && !f.startsWith("ISSUES") && !f.startsWith("_"))
      .filter((f) => !yearArg || f.startsWith(String(yearArg)))
      .filter((f) => !fromYear || parseInt(f.slice(0, 4), 10) >= fromYear)
      .sort();

    const filterLabel = yearArg ? ` (year=${yearArg})` : fromYear ? ` (from=${fromYear})` : "";
    console.log(`Found ${files.length} ${sourceType} files${filterLabel}\n`);

    let totalChunks = 0;
    let totalEmbedded = 0;
    let totalFailed = 0;

    for (const file of files) {
      const result = await importFile(path.join(dir, file), sourceType);
      totalChunks += result.chunks;
      totalEmbedded += result.embedded;
      totalFailed += result.failed;
    }

    console.log(
      `\nDone: ${totalChunks} chunks, ${totalEmbedded} embedded, ${totalFailed} failed`,
    );
  }

  // Verify
  const stats = await prisma.$queryRawUnsafe<
    { total: number; with_emb: number; skip_emb: number; with_sv: number }[]
  >(`
    SELECT COUNT(*)::int            AS total,
           COUNT(embedding)::int    AS with_emb,
           SUM(CASE WHEN "skipEmbedding" THEN 1 ELSE 0 END)::int AS skip_emb,
           COUNT("searchVector")::int AS with_sv
    FROM "Chunk"
  `);
  console.log("Verification:", stats[0]);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
