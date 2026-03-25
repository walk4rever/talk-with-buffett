-- Add Chinese section path and skip-embedding flag to Chunk
ALTER TABLE "Chunk" ADD COLUMN IF NOT EXISTS "sectionZh" TEXT;
ALTER TABLE "Chunk" ADD COLUMN IF NOT EXISTS "skipEmbedding" BOOLEAN NOT NULL DEFAULT FALSE;
