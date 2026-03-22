-- Add contentMd to Letter
ALTER TABLE "Letter" ADD COLUMN "contentMd" TEXT;

-- Create Chunk table
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL,
    "letterId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT,
    "contentEn" TEXT NOT NULL,
    "contentZh" TEXT,
    "embedding" vector(1024),
    "searchVector" tsvector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- Unique constraint
CREATE UNIQUE INDEX "Chunk_letterId_order_key" ON "Chunk"("letterId", "order");

-- Foreign key
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_letterId_fkey"
    FOREIGN KEY ("letterId") REFERENCES "Letter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- GIN index for full-text search
CREATE INDEX "Chunk_searchVector_idx" ON "Chunk" USING gin("searchVector");

-- HNSW index for vector search
CREATE INDEX "Chunk_embedding_idx" ON "Chunk" USING hnsw("embedding" vector_cosine_ops);

-- Auto-update searchVector trigger
CREATE OR REPLACE FUNCTION chunk_search_vector_update() RETURNS trigger AS $$
BEGIN
    NEW."searchVector" := to_tsvector('english', COALESCE(NEW."contentEn", ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chunk_search_vector_trigger
    BEFORE INSERT OR UPDATE OF "contentEn" ON "Chunk"
    FOR EACH ROW
    EXECUTE FUNCTION chunk_search_vector_update();
