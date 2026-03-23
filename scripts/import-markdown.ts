/**
 * Import markdown letters from data/letters/ into the database.
 *
 * 1. Reads each markdown file → stores full content in Letter.contentMd
 * 2. Splits by headings (# / ##) into chunks
 * 3. Separates Chinese / English paragraphs within each chunk
 * 4. Writes Chunk rows with tsvector (auto via trigger) and embedding
 *
 * Usage: npx tsx scripts/import-markdown.ts                    # all shareholder letters
 *        npx tsx scripts/import-markdown.ts 2025              # single year
 *        npx tsx scripts/import-markdown.ts --type partnership # all partnership letters
 *        npx tsx scripts/import-markdown.ts --type partnership 1965  # single year
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LETTERS_DIR = path.join(__dirname, "..", "data", "letters");

const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || process.env.AI_API_KEY!;
const EMBEDDING_API_BASE_URL = process.env.EMBEDDING_API_BASE_URL || process.env.AI_API_BASE_URL!;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "doubao-embedding-large";

// ── CJK detection ──────────────────────────────────────────────────────────

function isCJK(text: string): boolean {
  // Check if the first non-whitespace, non-punctuation character is CJK
  const stripped = text.replace(/^[\s\-\*\d\.\(\)（）\[\]·]+/, "");
  if (!stripped) return false;
  const code = stripped.codePointAt(0) ?? 0;
  // CJK Unified Ideographs + common ranges
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
    (code >= 0xf900 && code <= 0xfaff) || // CJK Compat
    (code >= 0x2e80 && code <= 0x2eff) || // CJK Radicals
    (code >= 0x3000 && code <= 0x303f)    // CJK Symbols
  );
}

// ── Strip metadata header ──────────────────────────────────────────────────

function stripHeader(md: string): string {
  // Files start with "原文信息：" metadata block with "- 标题:", "- 作者:" etc.
  // Some end with "---", some with "[^*]:", some go straight to content.
  // Strategy: find the last metadata line (starting with "- " or "[^*]" or "---"),
  // then skip to the next non-empty line.
  const lines = md.split("\n");
  let lastMetaLine = 0;

  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const t = lines[i].trim();
    if (
      t.startsWith("原文信息") ||
      t.startsWith("- 标题") ||
      t.startsWith("- 作者") ||
      t.startsWith("- 发表") ||
      t.startsWith("- 链接") ||
      t.startsWith("- 中文") ||
      t.startsWith("- 整理") ||
      t.startsWith("- 修订") ||
      t.startsWith("- 校译") ||
      t.startsWith("- 校对") ||
      t.startsWith("[^") ||
      (t === "---" && i < 20) ||
      t === ""
    ) {
      lastMetaLine = i;
    }
  }

  return lines.slice(lastMetaLine + 1).join("\n").trim();
}

// ── Split markdown into chunks by headings ─────────────────────────────────

interface RawChunk {
  title: string | null;
  content: string; // full text including both languages
}

function splitByHeadings(md: string): RawChunk[] {
  const body = stripHeader(md);
  const lines = body.split("\n");
  const chunks: RawChunk[] = [];

  let currentTitle: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      // Save previous chunk
      if (currentLines.length > 0) {
        const content = currentLines.join("\n").trim();
        if (content) {
          chunks.push({ title: currentTitle, content });
        }
      }
      // Extract English part of heading (before Chinese)
      const fullTitle = headingMatch[2].trim();
      // Headings like "# Insurance Underwriting 保险承保业务" — take English part
      const parts = fullTitle.split(/\s+/);
      const enParts: string[] = [];
      for (const p of parts) {
        if (isCJK(p)) break;
        enParts.push(p);
      }
      currentTitle = enParts.length > 0 ? enParts.join(" ") : fullTitle;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Last chunk
  if (currentLines.length > 0) {
    const content = currentLines.join("\n").trim();
    if (content) {
      chunks.push({ title: currentTitle, content });
    }
  }

  // If no headings were found, treat entire body as one chunk
  if (chunks.length === 0 && body.trim()) {
    chunks.push({ title: null, content: body.trim() });
  }

  return chunks;
}

// ── Separate English and Chinese from a chunk ──────────────────────────────

interface SeparatedChunk {
  title: string | null;
  contentEn: string;
  contentZh: string;
}

function separateLanguages(chunk: RawChunk): SeparatedChunk {
  const paragraphs = chunk.content.split(/\n\n+/);
  const enParts: string[] = [];
  const zhParts: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Tables and footnotes: check first content line
    const firstContentLine = trimmed.split("\n").find(l => l.trim() && !l.trim().startsWith("|--") && !l.trim().startsWith("---"));
    const testText = firstContentLine || trimmed;

    if (isCJK(testText)) {
      zhParts.push(trimmed);
    } else {
      enParts.push(trimmed);
    }
  }

  return {
    title: chunk.title,
    contentEn: enParts.join("\n\n"),
    contentZh: zhParts.join("\n\n"),
  };
}

// ── Split long chunks by paragraphs (~800 tokens ≈ ~3200 chars) ────────────

const MAX_CHARS = 3200;

function splitLongChunks(chunks: SeparatedChunk[]): SeparatedChunk[] {
  const result: SeparatedChunk[] = [];

  for (const chunk of chunks) {
    if (chunk.contentEn.length <= MAX_CHARS) {
      result.push(chunk);
      continue;
    }

    // Split English by paragraphs, keep Chinese aligned by count
    const enParas = chunk.contentEn.split(/\n\n+/);
    const zhParas = chunk.contentZh.split(/\n\n+/);

    let currentEn: string[] = [];
    let currentZh: string[] = [];
    let currentLen = 0;
    let partNum = 0;

    for (let i = 0; i < enParas.length; i++) {
      const enPara = enParas[i];
      if (currentLen + enPara.length > MAX_CHARS && currentEn.length > 0) {
        // Flush
        result.push({
          title: chunk.title ? `${chunk.title} (${++partNum})` : null,
          contentEn: currentEn.join("\n\n"),
          contentZh: currentZh.join("\n\n"),
        });
        currentEn = [];
        currentZh = [];
        currentLen = 0;
      }
      currentEn.push(enPara);
      if (i < zhParas.length) currentZh.push(zhParas[i]);
      currentLen += enPara.length;
    }

    if (currentEn.length > 0) {
      result.push({
        title: chunk.title ? (partNum > 0 ? `${chunk.title} (${++partNum})` : chunk.title) : null,
        contentEn: currentEn.join("\n\n"),
        contentZh: currentZh.join("\n\n"),
      });
    }
  }

  return result;
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
      input: [{ type: "text", text: text.slice(0, 4000) }], // truncate for safety
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

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // Parse args: [--type partnership] [year]
  const args = process.argv.slice(2);
  let letterType = "shareholder";
  let yearArg: number | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--type" && args[i + 1]) {
      letterType = args[++i];
    } else if (/^\d{4}$/.test(args[i])) {
      yearArg = parseInt(args[i], 10);
    }
  }

  const isPartnership = letterType === "partnership";
  const lettersDir = isPartnership
    ? path.join(LETTERS_DIR, "partnership")
    : LETTERS_DIR;

  const files = fs.readdirSync(lettersDir)
    .filter(f => f.endsWith(".md"))
    .filter(f => !yearArg || f.startsWith(String(yearArg)))
    .sort();

  console.log(`Found ${files.length} ${letterType} files${yearArg ? ` (year=${yearArg})` : ""}\n`);

  let totalChunks = 0;
  let totalFailed = 0;

  for (const file of files) {
    const yearMatch = file.match(/^(\d{4})/);
    if (!yearMatch) continue;
    const year = parseInt(yearMatch[1], 10);

    // For partnership letters, extract date from filename (YYYYMMDD)
    const dateMatch = file.match(/^(\d{4})(\d{2})(\d{2})?/);
    const letterDate = isPartnership && dateMatch
      ? `${dateMatch[1]}-${dateMatch[2]}${dateMatch[3] ? `-${dateMatch[3]}` : ""}`
      : null;

    const md = fs.readFileSync(path.join(lettersDir, file), "utf-8");

    // Split and separate
    const rawChunks = splitByHeadings(md);
    const separated = rawChunks.map(separateLanguages);
    const chunks = splitLongChunks(separated);

    // Filter out empty chunks
    const validChunks = chunks.filter(c => c.contentEn.trim().length > 20);

    const label = letterDate ? `${year} (${letterDate})` : `${year}`;
    console.log(`${label}: ${validChunks.length} chunks`);

    // Upsert Letter with contentMd
    const title = isPartnership
      ? `${year} Letter to Partners${letterDate ? ` (${letterDate})` : ""}`
      : `${year} Letter to Berkshire Shareholders`;
    const url = isPartnership
      ? "https://theoraclesclassroom.com/wp-content/uploads/2020/05/Buffett-Partnership-Letters-1957-1970-High-Quality.pdf"
      : `https://www.berkshirehathaway.com/letters/${year}ltr.pdf`;

    // findFirst + create/update because composite unique with nullable date
    let letter = await prisma.letter.findFirst({
      where: { year, type: letterType, date: letterDate },
    });
    if (letter) {
      letter = await prisma.letter.update({
        where: { id: letter.id },
        data: { contentMd: md },
      });
    } else {
      letter = await prisma.letter.create({
        data: { year, type: letterType, date: letterDate, title, url, contentMd: md },
      });
    }

    // Delete existing chunks for this letter (idempotent re-run)
    await prisma.$executeRawUnsafe(
      `DELETE FROM "Chunk" WHERE "letterId" = $1`,
      letter.id,
    );

    // Insert chunks with embedding
    for (let i = 0; i < validChunks.length; i++) {
      const chunk = validChunks[i];

      let embedding: number[] | null = null;
      try {
        embedding = await getEmbedding(chunk.contentEn);
      } catch (err) {
        console.error(`  Failed embedding for chunk ${i + 1}: ${err}`);
        totalFailed++;
      }

      if (embedding) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "Chunk" ("id", "letterId", "order", "title", "contentEn", "contentZh", "embedding", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::vector, NOW())`,
          letter.id,
          i + 1,
          chunk.title,
          chunk.contentEn,
          chunk.contentZh || null,
          JSON.stringify(embedding),
        );
      } else {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "Chunk" ("id", "letterId", "order", "title", "contentEn", "contentZh", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, NOW())`,
          letter.id,
          i + 1,
          chunk.title,
          chunk.contentEn,
          chunk.contentZh || null,
        );
      }

      totalChunks++;

      // Rate limit: 100ms between embedding calls
      if (embedding) await new Promise(r => setTimeout(r, 100));
    }
  }

  console.log(`\nDone: ${totalChunks} chunks imported, ${totalFailed} embedding failures`);

  // Verify
  const stats = await prisma.$queryRawUnsafe<{ total: number; with_emb: number; with_sv: number }[]>(`
    SELECT COUNT(*)::int as total,
           COUNT(embedding)::int as with_emb,
           COUNT("searchVector")::int as with_sv
    FROM "Chunk"
  `);
  console.log("Verification:", stats[0]);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
