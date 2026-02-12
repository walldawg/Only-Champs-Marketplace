-- CreateTable
CREATE TABLE "UserCardAggregate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "versionKey" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserCardAggregate_versionKey_fkey" FOREIGN KEY ("versionKey") REFERENCES "CardVersion" ("versionKey") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserCardInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "versionKey" TEXT NOT NULL,
    "serialNumber" INTEGER,
    "serialMax" INTEGER,
    "treatment" TEXT,
    "condition" TEXT,
    "isAutograph" BOOLEAN NOT NULL DEFAULT false,
    "oddityType" TEXT,
    "oddityNotes" TEXT,
    "verification" TEXT NOT NULL DEFAULT 'NONE',
    "frontImageUrl" TEXT,
    "backImageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserCardInstance_versionKey_fkey" FOREIGN KEY ("versionKey") REFERENCES "CardVersion" ("versionKey") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketplaceListingAggregate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sellerUserId" TEXT NOT NULL,
    "versionKey" TEXT NOT NULL,
    "listingType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priceCents" INTEGER,
    "currency" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketplaceListingAggregate_versionKey_fkey" FOREIGN KEY ("versionKey") REFERENCES "CardVersion" ("versionKey") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketplaceListingInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sellerUserId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "listingType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "priceCents" INTEGER,
    "currency" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketplaceListingInstance_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "UserCardInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OdditySubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submitterUserId" TEXT NOT NULL,
    "versionKey" TEXT NOT NULL,
    "oddityType" TEXT NOT NULL,
    "claimSummary" TEXT,
    "frontImageUrl" TEXT,
    "backImageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "adminNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" DATETIME,
    CONSTRAINT "OdditySubmission_versionKey_fkey" FOREIGN KEY ("versionKey") REFERENCES "CardVersion" ("versionKey") ON DELETE RESTRICT ON UPDATE CASCADE
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
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "UserCardAggregate_versionKey_idx" ON "UserCardAggregate"("versionKey");

-- CreateIndex
CREATE INDEX "UserCardAggregate_userId_idx" ON "UserCardAggregate"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCardAggregate_userId_versionKey_key" ON "UserCardAggregate"("userId", "versionKey");

-- CreateIndex
CREATE INDEX "UserCardInstance_versionKey_idx" ON "UserCardInstance"("versionKey");

-- CreateIndex
CREATE INDEX "UserCardInstance_userId_idx" ON "UserCardInstance"("userId");

-- CreateIndex
CREATE INDEX "MarketplaceListingAggregate_versionKey_idx" ON "MarketplaceListingAggregate"("versionKey");

-- CreateIndex
CREATE INDEX "MarketplaceListingAggregate_sellerUserId_idx" ON "MarketplaceListingAggregate"("sellerUserId");

-- CreateIndex
CREATE INDEX "MarketplaceListingAggregate_status_idx" ON "MarketplaceListingAggregate"("status");

-- CreateIndex
CREATE INDEX "MarketplaceListingInstance_sellerUserId_idx" ON "MarketplaceListingInstance"("sellerUserId");

-- CreateIndex
CREATE INDEX "MarketplaceListingInstance_status_idx" ON "MarketplaceListingInstance"("status");

-- CreateIndex
CREATE INDEX "OdditySubmission_versionKey_idx" ON "OdditySubmission"("versionKey");

-- CreateIndex
CREATE INDEX "OdditySubmission_submitterUserId_idx" ON "OdditySubmission"("submitterUserId");

-- CreateIndex
CREATE INDEX "OdditySubmission_status_idx" ON "OdditySubmission"("status");
