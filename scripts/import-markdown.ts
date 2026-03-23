/**
 * Import markdown sources into the database.
 *
 * Data lives under data/<type>/ where type is one of:
 *   shareholder, partnership, annual_meeting
 *
 * Usage:
 *   npx tsx scripts/import-markdown.ts                                # all shareholder
 *   npx tsx scripts/import-markdown.ts --type annual_meeting          # all annual_meeting
 *   npx tsx scripts/import-markdown.ts --type partnership 1965        # partnership, single year
 *   npx tsx scripts/import-markdown.ts --file data/shareholder/2025_Letter_to_Berkshire_Shareholders.md
 *
 * The --file flag imports a single markdown file. The type is inferred from
 * its parent directory name (shareholder / partnership / annual_meeting).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "..", "data");

const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || process.env.AI_API_KEY!;
const EMBEDDING_API_BASE_URL = process.env.EMBEDDING_API_BASE_URL || process.env.AI_API_BASE_URL!;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "doubao-embedding-large";

// ── CJK detection ──────────────────────────────────────────────────────────

function isCJK(text: string): boolean {
  const stripped = text.replace(/^[\s\-\*\d\.\(\)（）\[\]·]+/, "");
  if (!stripped) return false;
  const code = stripped.codePointAt(0) ?? 0;
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x2e80 && code <= 0x2eff) ||
    (code >= 0x3000 && code <= 0x303f)
  );
}

// ── Strip metadata header ──────────────────────────────────────────────────

function stripHeader(md: string): string {
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
  content: string;
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
      if (currentLines.length > 0) {
        const content = currentLines.join("\n").trim();
        if (content) {
          chunks.push({ title: currentTitle, content });
        }
      }
      const fullTitle = headingMatch[2].trim();
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

  if (currentLines.length > 0) {
    const content = currentLines.join("\n").trim();
    if (content) {
      chunks.push({ title: currentTitle, content });
    }
  }

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

    const enParas = chunk.contentEn.split(/\n\n+/);
    const zhParas = chunk.contentZh.split(/\n\n+/);

    let currentEn: string[] = [];
    let currentZh: string[] = [];
    let currentLen = 0;
    let partNum = 0;

    for (let i = 0; i < enParas.length; i++) {
      const enPara = enParas[i];
      if (currentLen + enPara.length > MAX_CHARS && currentEn.length > 0) {
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

async function importFile(filePath: string, sourceType: string): Promise<{ chunks: number; failed: number }> {
  const file = path.basename(filePath);
  const yearMatch = file.match(/^(\d{4})/);
  if (!yearMatch) {
    console.error(`  Skipping ${file}: no year in filename`);
    return { chunks: 0, failed: 0 };
  }
  const year = parseInt(yearMatch[1], 10);

  // Partnership letters: extract date from YYYYMMDD filename
  const dateMatch = file.match(/^(\d{4})(\d{2})(\d{2})?/);
  const sourceDate = sourceType === "partnership" && dateMatch
    ? `${dateMatch[1]}-${dateMatch[2]}${dateMatch[3] ? `-${dateMatch[3]}` : ""}`
    : null;

  const md = fs.readFileSync(filePath, "utf-8");

  const rawChunks = splitByHeadings(md);
  const separated = rawChunks.map(separateLanguages);
  const chunks = splitLongChunks(separated);
  const validChunks = chunks.filter(c => c.contentEn.trim().length > 20);

  const label = sourceDate ? `${year} (${sourceDate})` : `${year}`;
  console.log(`${label}: ${validChunks.length} chunks`);

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
  await prisma.$executeRawUnsafe(
    `DELETE FROM "Chunk" WHERE "sourceId" = $1`,
    source.id,
  );

  let totalFailed = 0;

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
        `INSERT INTO "Chunk" ("id", "sourceId", "order", "title", "contentEn", "contentZh", "embedding", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::vector, NOW())`,
        source.id,
        i + 1,
        chunk.title,
        chunk.contentEn,
        chunk.contentZh || null,
        JSON.stringify(embedding),
      );
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Chunk" ("id", "sourceId", "order", "title", "contentEn", "contentZh", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, NOW())`,
        source.id,
        i + 1,
        chunk.title,
        chunk.contentEn,
        chunk.contentZh || null,
      );
    }

    // Rate limit: 100ms between embedding calls
    if (embedding) await new Promise(r => setTimeout(r, 100));
  }

  return { chunks: validChunks.length, failed: totalFailed };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let sourceType = "shareholder";
  let yearArg: number | null = null;
  let singleFile: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--type" && args[i + 1]) {
      sourceType = args[++i];
    } else if (args[i] === "--file" && args[i + 1]) {
      singleFile = args[++i];
    } else if (/^\d{4}$/.test(args[i])) {
      yearArg = parseInt(args[i], 10);
    }
  }

  // Single-file mode
  if (singleFile) {
    const resolved = path.resolve(singleFile);
    if (!fs.existsSync(resolved)) {
      console.error(`File not found: ${resolved}`);
      process.exit(1);
    }

    // Infer type from parent directory name
    const parentDir = path.basename(path.dirname(resolved));
    const inferredType = ["shareholder", "partnership", "annual_meeting"].includes(parentDir)
      ? parentDir
      : sourceType;

    console.log(`Importing single file: ${resolved} (type=${inferredType})\n`);
    const result = await importFile(resolved, inferredType);
    console.log(`\nDone: ${result.chunks} chunks imported, ${result.failed} embedding failures`);
  } else {
    // Batch mode: import all .md files from data/<type>/
    const dir = path.join(DATA_DIR, sourceType);
    if (!fs.existsSync(dir)) {
      console.error(`Directory not found: ${dir}`);
      console.error(`Expected one of: data/shareholder, data/partnership, data/annual_meeting`);
      process.exit(1);
    }

    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith(".md"))
      .filter(f => !yearArg || f.startsWith(String(yearArg)))
      .sort();

    console.log(`Found ${files.length} ${sourceType} files${yearArg ? ` (year=${yearArg})` : ""}\n`);

    let totalChunks = 0;
    let totalFailed = 0;

    for (const file of files) {
      const result = await importFile(path.join(dir, file), sourceType);
      totalChunks += result.chunks;
      totalFailed += result.failed;
    }

    console.log(`\nDone: ${totalChunks} chunks imported, ${totalFailed} embedding failures`);
  }

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
