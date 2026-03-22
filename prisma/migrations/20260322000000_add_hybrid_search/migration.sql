-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column (2048 dimensions, matching doubao multimodal embedding)
ALTER TABLE "Section" ADD COLUMN "embedding" vector(2048);

-- Add tsvector column for full-text search
ALTER TABLE "Section" ADD COLUMN "searchVector" tsvector;

-- Populate searchVector from existing contentEn
UPDATE "Section" SET "searchVector" = to_tsvector('english', "contentEn");

-- Create GIN index for full-text search
CREATE INDEX "Section_searchVector_idx" ON "Section" USING GIN ("searchVector");

-- NOTE: No HNSW/IVFFlat index on embedding for now.
-- With ~2400 rows, exact scan (sequential) takes <10ms.
-- Add an index when row count exceeds ~10,000.

-- Auto-update searchVector when contentEn changes
CREATE OR REPLACE FUNCTION section_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" := to_tsvector('english', COALESCE(NEW."contentEn", ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER section_search_vector_trigger
  BEFORE INSERT OR UPDATE OF "contentEn" ON "Section"
  FOR EACH ROW
  EXECUTE FUNCTION section_search_vector_update();
