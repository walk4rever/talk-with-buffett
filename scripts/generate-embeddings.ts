/**
 * Generate embeddings for all Section rows that don't have one yet.
 *
 * Usage:
 *   npx tsx scripts/generate-embeddings.ts
 *
 * Reads AI_API_KEY, AI_API_BASE_URL, EMBEDDING_MODEL from .env
 */

import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY ?? process.env.AI_API_KEY!;
const EMBEDDING_API_BASE_URL = process.env.EMBEDDING_API_BASE_URL ?? process.env.AI_API_BASE_URL!;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "doubao-embedding-large";
const BATCH_SIZE = 10;

async function getEmbedding(text: string): Promise<number[]> {
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
    const errText = await res.text();
    throw new Error(`Embedding API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  // Multimodal API returns data.embedding (object), not data[0].embedding (array)
  return data.data.embedding;
}

async function main() {
  // Find sections without embeddings
  const sections = await prisma.$queryRawUnsafe<{ id: string; contentEn: string }[]>(
    `SELECT "id", "contentEn" FROM "Section" WHERE "embedding" IS NULL ORDER BY "id"`,
  );

  console.log(`Found ${sections.length} sections without embeddings`);

  if (sections.length === 0) {
    console.log("All sections already have embeddings. Done.");
    return;
  }

  let processed = 0;
  let failed = 0;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const text = section.contentEn.slice(0, 8000); // Truncate very long sections

    try {
      const embedding = await getEmbedding(text);
      const embeddingStr = `[${embedding.join(",")}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE "Section" SET "embedding" = $1::vector WHERE "id" = $2`,
        embeddingStr,
        section.id,
      );
      processed++;

      if (processed % BATCH_SIZE === 0 || i === sections.length - 1) {
        console.log(`  [${processed}/${sections.length}] embedded (${failed} failed)`);
      }
    } catch (err) {
      failed++;
      console.error(`  Failed section ${section.id}:`, err instanceof Error ? err.message : err);
    }

    // Small delay to avoid rate limiting
    if (i < sections.length - 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  console.log(`\nDone! ${processed}/${sections.length} sections embedded.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
