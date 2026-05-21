CREATE TABLE "HomeSignalSnapshot" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "sourceQuarter" TEXT,
    "payload" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeSignalSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HomeSignalSnapshot_scope_key" ON "HomeSignalSnapshot"("scope");
