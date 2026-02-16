-- CreateTable
CREATE TABLE "RewardDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "defaultClaimWindowSeconds" INTEGER,
    "mintCurrency" TEXT NOT NULL DEFAULT 'BOBUX',
    "mintAmount" INTEGER NOT NULL DEFAULT 0,
    "lotTtlSeconds" INTEGER,
    "lotExpiresAtFixed" DATETIME,
    "lotExpirationPolicy" TEXT NOT NULL DEFAULT 'RELATIVE_TTL',
    "maxClaimsPerUser" INTEGER,
    "maxClaimsGlobal" INTEGER,
    "cooldownSecondsPerUser" INTEGER,
    "createdByAdminId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RewardTrigger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "definitionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "triggerType" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL DEFAULT 'GLOBAL',
    "scopeRef" TEXT,
    "configJson" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "createdByAdminId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RewardGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "definitionId" TEXT NOT NULL,
    "triggerId" TEXT,
    "userId" TEXT NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimableFrom" DATETIME,
    "claimableUntil" DATETIME,
    "claimWindowSource" TEXT NOT NULL DEFAULT 'DEFAULT',
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "claimedAt" DATETIME,
    "expiredAt" DATETIME,
    "revokedAt" DATETIME,
    "revokedReason" TEXT,
    "grantKey" TEXT,
    "createdByAdminId" TEXT,
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RewardClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "grantId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "claimedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimRequestId" TEXT,
    "mintedTotal" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "BobuxLot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'REWARD_CLAIM',
    "sourceId" TEXT,
    "amountInitial" INTEGER NOT NULL,
    "amountRemaining" INTEGER NOT NULL,
    "mintedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    "expiredAt" DATETIME,
    "rewardDefinitionId" TEXT,
    "rewardTriggerId" TEXT,
    "rewardGrantId" TEXT,
    "rewardClaimId" TEXT
);

-- CreateTable
CREATE TABLE "RewardEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventType" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "definitionId" TEXT,
    "triggerId" TEXT,
    "grantId" TEXT,
    "claimId" TEXT,
    "lotId" TEXT,
    "metaJson" JSONB
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
CREATE UNIQUE INDEX "RewardDefinition_code_key" ON "RewardDefinition"("code");

-- CreateIndex
CREATE INDEX "RewardDefinition_status_startsAt_endsAt_idx" ON "RewardDefinition"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "RewardTrigger_definitionId_status_idx" ON "RewardTrigger"("definitionId", "status");

-- CreateIndex
CREATE INDEX "RewardTrigger_triggerType_status_idx" ON "RewardTrigger"("triggerType", "status");

-- CreateIndex
CREATE INDEX "RewardTrigger_scopeType_scopeRef_idx" ON "RewardTrigger"("scopeType", "scopeRef");

-- CreateIndex
CREATE UNIQUE INDEX "RewardGrant_grantKey_key" ON "RewardGrant"("grantKey");

-- CreateIndex
CREATE INDEX "RewardGrant_userId_state_idx" ON "RewardGrant"("userId", "state");

-- CreateIndex
CREATE INDEX "RewardGrant_definitionId_state_idx" ON "RewardGrant"("definitionId", "state");

-- CreateIndex
CREATE INDEX "RewardGrant_triggerId_idx" ON "RewardGrant"("triggerId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardClaim_grantId_key" ON "RewardClaim"("grantId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardClaim_claimRequestId_key" ON "RewardClaim"("claimRequestId");

-- CreateIndex
CREATE INDEX "RewardClaim_userId_claimedAt_idx" ON "RewardClaim"("userId", "claimedAt");

-- CreateIndex
CREATE INDEX "RewardClaim_definitionId_claimedAt_idx" ON "RewardClaim"("definitionId", "claimedAt");

-- CreateIndex
CREATE INDEX "BobuxLot_userId_expiresAt_idx" ON "BobuxLot"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "BobuxLot_rewardClaimId_idx" ON "BobuxLot"("rewardClaimId");

-- CreateIndex
CREATE INDEX "BobuxLot_sourceType_sourceId_idx" ON "BobuxLot"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "RewardEvent_eventType_occurredAt_idx" ON "RewardEvent"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "RewardEvent_userId_occurredAt_idx" ON "RewardEvent"("userId", "occurredAt");
