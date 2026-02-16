-- CreateTable
CREATE TABLE "RuleSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "rulesJson" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ModeRuleBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modeKey" TEXT NOT NULL,
    "ruleSetKey" TEXT NOT NULL,
    "ruleSetVersion" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    "setCode" TEXT,
    "versionCode" TEXT NOT NULL,
    "finish" TEXT DEFAULT 'NONFOIL',
    "treatmentKey" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "requirements" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CardVersion_conceptKey_fkey" FOREIGN KEY ("conceptKey") REFERENCES "CardConcept" ("hybridKey") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CardVersion_setCode_treatmentKey_fkey" FOREIGN KEY ("setCode", "treatmentKey") REFERENCES "Treatment" ("setCode", "key") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CardVersion" ("attributes", "conceptKey", "conceptType", "createdAt", "finish", "requirements", "setCode", "treatmentKey", "updatedAt", "versionCode", "versionKey") SELECT "attributes", "conceptKey", "conceptType", "createdAt", "finish", "requirements", "setCode", "treatmentKey", "updatedAt", "versionCode", "versionKey" FROM "CardVersion";
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
CREATE UNIQUE INDEX "RuleSet_key_version_key" ON "RuleSet"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ModeRuleBinding_modeKey_key" ON "ModeRuleBinding"("modeKey");
