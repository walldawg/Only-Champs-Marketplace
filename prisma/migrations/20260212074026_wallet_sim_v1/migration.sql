-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WalletAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WalletAsset_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutoRefillConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "triggerThreshold" INTEGER NOT NULL DEFAULT 0,
    "refillAmount" INTEGER NOT NULL DEFAULT 0,
    "maxRefillsPerDay" INTEGER NOT NULL DEFAULT 0,
    "lastRefillAt" DATETIME,
    "refillsToday" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AutoRefillConfig_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SimulationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "deckId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'STANDARD',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "cu" INTEGER NOT NULL,
    "estimatedBobux" INTEGER NOT NULL,
    "spendPreference" TEXT NOT NULL DEFAULT 'EARNED_FIRST',
    "inputJson" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "SimulationResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "summaryJson" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SimulationResult_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "SimulationJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CardConcept" (
    "hybridKey" TEXT NOT NULL PRIMARY KEY,
    "setCode" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_CardConcept" ("createdAt", "hybridKey", "meta", "name", "setCode", "slug", "type", "updatedAt") SELECT "createdAt", "hybridKey", "meta", "name", "setCode", "slug", "type", "updatedAt" FROM "CardConcept";
DROP TABLE "CardConcept";
ALTER TABLE "new_CardConcept" RENAME TO "CardConcept";
CREATE INDEX "CardConcept_setCode_idx" ON "CardConcept"("setCode");
CREATE INDEX "CardConcept_type_idx" ON "CardConcept"("type");
CREATE UNIQUE INDEX "CardConcept_setCode_type_slug_key" ON "CardConcept"("setCode", "type", "slug");
CREATE TABLE "new_CardVersion" (
    "versionKey" TEXT NOT NULL PRIMARY KEY,
    "conceptKey" TEXT NOT NULL,
    "conceptType" TEXT NOT NULL,
    "versionCode" TEXT NOT NULL,
    "finish" TEXT DEFAULT 'NONFOIL',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "requirements" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CardVersion_conceptKey_fkey" FOREIGN KEY ("conceptKey") REFERENCES "CardConcept" ("hybridKey") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CardVersion" ("attributes", "conceptKey", "conceptType", "createdAt", "finish", "requirements", "updatedAt", "versionCode", "versionKey") SELECT "attributes", "conceptKey", "conceptType", "createdAt", "finish", "requirements", "updatedAt", "versionCode", "versionKey" FROM "CardVersion";
DROP TABLE "CardVersion";
ALTER TABLE "new_CardVersion" RENAME TO "CardVersion";
CREATE INDEX "CardVersion_conceptKey_idx" ON "CardVersion"("conceptKey");
CREATE INDEX "CardVersion_conceptType_idx" ON "CardVersion"("conceptType");
CREATE INDEX "CardVersion_versionCode_idx" ON "CardVersion"("versionCode");
CREATE TABLE "new_Game" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modeCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'LOBBY',
    "state" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Game" ("createdAt", "id", "modeCode", "state", "status", "updatedAt") SELECT "createdAt", "id", "modeCode", "state", "status", "updatedAt" FROM "Game";
DROP TABLE "Game";
ALTER TABLE "new_Game" RENAME TO "Game";
CREATE INDEX "Game_status_idx" ON "Game"("status");
CREATE INDEX "Game_modeCode_idx" ON "Game"("modeCode");
CREATE TABLE "new_GameEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "actorSeat" INTEGER,
    "cardVersionKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameEvent_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GameEvent_cardVersionKey_fkey" FOREIGN KEY ("cardVersionKey") REFERENCES "CardVersion" ("versionKey") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_GameEvent" ("actorSeat", "cardVersionKey", "createdAt", "gameId", "id", "payload", "seq", "type") SELECT "actorSeat", "cardVersionKey", "createdAt", "gameId", "id", "payload", "seq", "type" FROM "GameEvent";
DROP TABLE "GameEvent";
ALTER TABLE "new_GameEvent" RENAME TO "GameEvent";
CREATE INDEX "GameEvent_gameId_createdAt_idx" ON "GameEvent"("gameId", "createdAt");
CREATE INDEX "GameEvent_type_idx" ON "GameEvent"("type");
CREATE INDEX "GameEvent_cardVersionKey_idx" ON "GameEvent"("cardVersionKey");
CREATE UNIQUE INDEX "GameEvent_gameId_seq_key" ON "GameEvent"("gameId", "seq");
CREATE TABLE "new_VerificationEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "verificationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerificationEvidence_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "Verification" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VerificationEvidence" ("createdAt", "id", "meta", "type", "uri", "verificationId") SELECT "createdAt", "id", "meta", "type", "uri", "verificationId" FROM "VerificationEvidence";
DROP TABLE "VerificationEvidence";
ALTER TABLE "new_VerificationEvidence" RENAME TO "VerificationEvidence";
CREATE INDEX "VerificationEvidence_verificationId_idx" ON "VerificationEvidence"("verificationId");
CREATE INDEX "VerificationEvidence_createdAt_idx" ON "VerificationEvidence"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "WalletAsset_walletId_idx" ON "WalletAsset"("walletId");

-- CreateIndex
CREATE INDEX "WalletAsset_assetType_idx" ON "WalletAsset"("assetType");

-- CreateIndex
CREATE UNIQUE INDEX "WalletAsset_walletId_assetType_key" ON "WalletAsset"("walletId", "assetType");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "WalletTransaction"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_assetType_idx" ON "WalletTransaction"("assetType");

-- CreateIndex
CREATE INDEX "WalletTransaction_reason_idx" ON "WalletTransaction"("reason");

-- CreateIndex
CREATE INDEX "WalletTransaction_expiresAt_idx" ON "WalletTransaction"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutoRefillConfig_walletId_key" ON "AutoRefillConfig"("walletId");

-- CreateIndex
CREATE INDEX "SimulationJob_userId_createdAt_idx" ON "SimulationJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SimulationJob_status_idx" ON "SimulationJob"("status");

-- CreateIndex
CREATE INDEX "SimulationJob_mode_idx" ON "SimulationJob"("mode");

-- CreateIndex
CREATE UNIQUE INDEX "SimulationResult_jobId_key" ON "SimulationResult"("jobId");
