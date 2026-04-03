-- CreateTable
CREATE TABLE "DigitalHumanProfile" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "status" TEXT NOT NULL DEFAULT 'active',
    "faceImageUrl" TEXT,
    "voiceProfile" TEXT,
    "providerMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigitalHumanProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigitalHumanJob" (
    "id" TEXT NOT NULL,
    "avatarProfileId" TEXT NOT NULL,
    "chatMessageId" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "providerJobId" TEXT,
    "subtitle" TEXT NOT NULL,
    "audioUrl" TEXT,
    "videoUrl" TEXT,
    "errorMessage" TEXT,
    "readyAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigitalHumanJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DigitalHumanProfile_key_key" ON "DigitalHumanProfile"("key");

-- CreateIndex
CREATE INDEX "DigitalHumanJob_chatMessageId_idx" ON "DigitalHumanJob"("chatMessageId");

-- CreateIndex
CREATE INDEX "DigitalHumanJob_status_readyAt_idx" ON "DigitalHumanJob"("status", "readyAt");

-- AddForeignKey
ALTER TABLE "DigitalHumanJob" ADD CONSTRAINT "DigitalHumanJob_avatarProfileId_fkey" FOREIGN KEY ("avatarProfileId") REFERENCES "DigitalHumanProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
