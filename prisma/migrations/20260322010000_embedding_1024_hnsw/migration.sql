-- Clear existing 2048-dim embeddings
UPDATE "Section" SET "embedding" = NULL;

-- Change column to 1024 dimensions
ALTER TABLE "Section" ALTER COLUMN "embedding" TYPE vector(1024);

-- Create HNSW index (1024 dims is within the 2000 limit)
CREATE INDEX "Section_embedding_idx" ON "Section" USING hnsw ("embedding" vector_cosine_ops);
