-- Rename Letter table to Source
ALTER TABLE "Letter" RENAME TO "Source";

-- Rename letterId column to sourceId in Chunk
ALTER TABLE "Chunk" RENAME COLUMN "letterId" TO "sourceId";

-- Add new columns for video/media support
ALTER TABLE "Source" ADD COLUMN "videoUrl" TEXT;
ALTER TABLE "Source" ADD COLUMN "videoSource" TEXT;
ALTER TABLE "Source" ADD COLUMN "thumbnailUrl" TEXT;
