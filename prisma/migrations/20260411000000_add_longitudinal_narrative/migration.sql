-- Longitudinal Narrative — multi-source intelligence layer
-- See PRODUCT.md "标的纵向叙事" section.
-- Adds 6 new tables: Entity / ExtSource / Mention / Financial / Holding / EntityRelation
-- Anchors all entities on SEC CIK to unify EDGAR / 13F / Buffett letter mentions.
--
-- Hand-crafted to skip the DigitalHumanProfile/DigitalHumanJob drift those
-- tables already exist in production but predate the migration history.

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cik" TEXT,
    "ticker" TEXT,
    "sector" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtSource" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT,
    "ts" TIMESTAMP(3),
    "filerEntityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mention" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "ts" TIMESTAMP(3),
    "sentiment" TEXT,
    "sentimentScore" DOUBLE PRECISION,
    "span" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Financial" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "periodType" TEXT NOT NULL,
    "lineItem" TEXT NOT NULL,
    "value" DECIMAL(65,30),
    "unit" TEXT,
    "rawXbrlTag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Financial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holding" (
    "id" TEXT NOT NULL,
    "holderEntityId" TEXT NOT NULL,
    "securityEntityId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "shares" BIGINT,
    "valueUsd" BIGINT,
    "percentOfPortfolio" DOUBLE PRECISION,
    "isNewPosition" BOOLEAN DEFAULT false,
    "isSoldOut" BOOLEAN DEFAULT false,
    "positionChangePct" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityRelation" (
    "id" TEXT NOT NULL,
    "srcEntityId" TEXT NOT NULL,
    "dstEntityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ts" TIMESTAMP(3),
    "evidenceChunkId" TEXT,
    "confidence" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityRelation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Entity_cik_key" ON "Entity"("cik");

-- CreateIndex
CREATE INDEX "Entity_type_idx" ON "Entity"("type");

-- CreateIndex
CREATE INDEX "Entity_ticker_idx" ON "Entity"("ticker");

-- CreateIndex
CREATE INDEX "ExtSource_kind_ts_idx" ON "ExtSource"("kind", "ts");

-- CreateIndex
CREATE INDEX "ExtSource_filerEntityId_idx" ON "ExtSource"("filerEntityId");

-- CreateIndex
CREATE INDEX "Mention_entityId_ts_idx" ON "Mention"("entityId", "ts");

-- CreateIndex
CREATE INDEX "Mention_chunkId_idx" ON "Mention"("chunkId");

-- CreateIndex
CREATE INDEX "Financial_entityId_periodEnd_idx" ON "Financial"("entityId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Financial_entityId_periodEnd_periodType_lineItem_key" ON "Financial"("entityId", "periodEnd", "periodType", "lineItem");

-- CreateIndex
CREATE INDEX "Holding_securityEntityId_asOfDate_idx" ON "Holding"("securityEntityId", "asOfDate");

-- CreateIndex
CREATE INDEX "Holding_holderEntityId_asOfDate_idx" ON "Holding"("holderEntityId", "asOfDate");

-- CreateIndex
CREATE UNIQUE INDEX "Holding_holderEntityId_securityEntityId_asOfDate_key" ON "Holding"("holderEntityId", "securityEntityId", "asOfDate");

-- CreateIndex
CREATE INDEX "EntityRelation_srcEntityId_type_idx" ON "EntityRelation"("srcEntityId", "type");

-- CreateIndex
CREATE INDEX "EntityRelation_dstEntityId_type_idx" ON "EntityRelation"("dstEntityId", "type");

-- AddForeignKey
ALTER TABLE "ExtSource" ADD CONSTRAINT "ExtSource_filerEntityId_fkey" FOREIGN KEY ("filerEntityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "Chunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Financial" ADD CONSTRAINT "Financial_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Financial" ADD CONSTRAINT "Financial_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ExtSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_holderEntityId_fkey" FOREIGN KEY ("holderEntityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_securityEntityId_fkey" FOREIGN KEY ("securityEntityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ExtSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityRelation" ADD CONSTRAINT "EntityRelation_srcEntityId_fkey" FOREIGN KEY ("srcEntityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityRelation" ADD CONSTRAINT "EntityRelation_dstEntityId_fkey" FOREIGN KEY ("dstEntityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityRelation" ADD CONSTRAINT "EntityRelation_evidenceChunkId_fkey" FOREIGN KEY ("evidenceChunkId") REFERENCES "Chunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
