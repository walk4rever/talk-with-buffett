-- Remove old unique index on year
DROP INDEX IF EXISTS "Letter_year_key";

-- Add type and date columns
ALTER TABLE "Letter" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'shareholder';
ALTER TABLE "Letter" ADD COLUMN "date" TEXT;

-- Add composite unique constraint
CREATE UNIQUE INDEX "Letter_year_type_date_key" ON "Letter"("year", "type", "date");
