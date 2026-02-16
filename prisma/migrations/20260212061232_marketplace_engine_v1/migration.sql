/*
  Warnings:

  - You are about to drop the `MarketplaceListingAggregate` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MarketplaceListingInstance` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UserCardAggregate` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `userId` on the `UserCardInstance` table. All the data in the column will be lost.
  - You are about to drop the column `verification` on the `UserCardInstance` table. All the data in the column will be lost.
  - Added the required column `ownerId` to the `UserCardInstance` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "MarketplaceListingAggregate_status_idx";

-- DropIndex
DROP INDEX "MarketplaceListingAggregate_sellerUserId_idx";

-- DropIndex
DROP INDEX "MarketplaceListingAggregate_versionKey_idx";

-- DropIndex
DROP INDEX "MarketplaceListingInstance_status_idx";

-- DropIndex
DROP INDEX "MarketplaceListingInstance_sellerUserId_idx";

-- DropIndex
DROP INDEX "UserCardAggregate_userId_versionKey_key";

-- DropIndex
DROP INDEX "UserCardAggregate_userId_idx";

-- DropIndex
DROP INDEX "UserCardAggregate_versionKey_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "MarketplaceListingAggregate";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "MarketplaceListingInstance";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "UserCardAggregate";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "OwnershipLot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "versionKey" TEXT NOT NULL,
    "qtyTotal" INTEGER NOT NULL DEFAULT 1,
    "qtyAvailable" INTEGER NOT NULL DEFAULT 1,
    "acquiredAt" DATETIME,
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OwnershipLot_versionKey_fkey" FOREIGN KEY ("versionKey") REFERENCES "CardVersion" ("versionKey") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "versionKey" TEXT NOT NULL,
    "deltaQty" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryLedger_versionKey_fkey" FOREIGN KEY ("versionKey") REFERENCES "CardVersion" ("versionKey") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "versionKey" TEXT,
    "instanceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "decidedAt" DATETIME,
    CONSTRAINT "Verification_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "UserCardInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "verificationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerificationEvidence_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "Verification" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationVote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "verificationId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "vote" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerificationVote_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "Verification" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationEscalation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "verificationId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedByAdminId" TEXT,
    "resolvedAt" DATETIME,
    CONSTRAINT "VerificationEscalation_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "Verification" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryVisibilityVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "versionKey" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "autoMatchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryVisibilityVersion_versionKey_fkey" FOREIGN KEY ("versionKey") REFERENCES "CardVersion" ("versionKey") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryVisibilityInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "autoMatchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryVisibilityInstance_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "UserCardInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sellerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currency" TEXT,
    "priceCents" INTEGER,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ListingLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listingId" TEXT NOT NULL,
    "versionKey" TEXT NOT NULL,
    "qtyListed" INTEGER NOT NULL DEFAULT 1,
    "qtyReserved" INTEGER NOT NULL DEFAULT 0,
    "qtySold" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ListingLine_versionKey_fkey" FOREIGN KEY ("versionKey") REFERENCES "CardVersion" ("versionKey") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ListingLine_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ListingLineInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listingId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "reserved" BOOLEAN NOT NULL DEFAULT false,
    "sold" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ListingLineInstance_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ListingLineInstance_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "UserCardInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "buyerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "currency" TEXT,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "listingId" TEXT,
    "versionKey" TEXT,
    "instanceId" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER,
    "lineTotalCents" INTEGER,
    CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryTransfer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "orderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "InventoryTransfer_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
CREATE TABLE "new_UserCardInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "versionKey" TEXT NOT NULL,
    "serialNumber" INTEGER,
    "serialMax" INTEGER,
    "treatment" TEXT,
    "condition" TEXT,
    "isAutograph" BOOLEAN NOT NULL DEFAULT false,
    "oddityType" TEXT,
    "oddityNotes" TEXT,
    "frontImageUrl" TEXT,
    "backImageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserCardInstance_versionKey_fkey" FOREIGN KEY ("versionKey") REFERENCES "CardVersion" ("versionKey") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_UserCardInstance" ("backImageUrl", "condition", "createdAt", "frontImageUrl", "id", "isAutograph", "oddityNotes", "oddityType", "serialMax", "serialNumber", "treatment", "updatedAt", "versionKey") SELECT "backImageUrl", "condition", "createdAt", "frontImageUrl", "id", "isAutograph", "oddityNotes", "oddityType", "serialMax", "serialNumber", "treatment", "updatedAt", "versionKey" FROM "UserCardInstance";
DROP TABLE "UserCardInstance";
ALTER TABLE "new_UserCardInstance" RENAME TO "UserCardInstance";
CREATE INDEX "UserCardInstance_versionKey_idx" ON "UserCardInstance"("versionKey");
CREATE INDEX "UserCardInstance_ownerId_idx" ON "UserCardInstance"("ownerId");
CREATE INDEX "UserCardInstance_serialNumber_serialMax_idx" ON "UserCardInstance"("serialNumber", "serialMax");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "OwnershipLot_ownerId_idx" ON "OwnershipLot"("ownerId");

-- CreateIndex
CREATE INDEX "OwnershipLot_versionKey_idx" ON "OwnershipLot"("versionKey");

-- CreateIndex
CREATE INDEX "OwnershipLot_ownerId_versionKey_idx" ON "OwnershipLot"("ownerId", "versionKey");

-- CreateIndex
CREATE INDEX "InventoryLedger_ownerId_idx" ON "InventoryLedger"("ownerId");

-- CreateIndex
CREATE INDEX "InventoryLedger_versionKey_idx" ON "InventoryLedger"("versionKey");

-- CreateIndex
CREATE INDEX "InventoryLedger_createdAt_idx" ON "InventoryLedger"("createdAt");

-- CreateIndex
CREATE INDEX "InventoryLedger_refType_refId_idx" ON "InventoryLedger"("refType", "refId");

-- CreateIndex
CREATE INDEX "Verification_ownerId_idx" ON "Verification"("ownerId");

-- CreateIndex
CREATE INDEX "Verification_scope_status_idx" ON "Verification"("scope", "status");

-- CreateIndex
CREATE INDEX "Verification_versionKey_idx" ON "Verification"("versionKey");

-- CreateIndex
CREATE INDEX "Verification_instanceId_idx" ON "Verification"("instanceId");

-- CreateIndex
CREATE INDEX "Verification_lane_status_idx" ON "Verification"("lane", "status");

-- CreateIndex
CREATE INDEX "VerificationEvidence_verificationId_idx" ON "VerificationEvidence"("verificationId");

-- CreateIndex
CREATE INDEX "VerificationEvidence_createdAt_idx" ON "VerificationEvidence"("createdAt");

-- CreateIndex
CREATE INDEX "VerificationVote_verificationId_idx" ON "VerificationVote"("verificationId");

-- CreateIndex
CREATE INDEX "VerificationVote_voterId_idx" ON "VerificationVote"("voterId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationVote_verificationId_voterId_key" ON "VerificationVote"("verificationId", "voterId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationEscalation_verificationId_key" ON "VerificationEscalation"("verificationId");

-- CreateIndex
CREATE INDEX "VerificationEscalation_createdAt_idx" ON "VerificationEscalation"("createdAt");

-- CreateIndex
CREATE INDEX "InventoryVisibilityVersion_ownerId_idx" ON "InventoryVisibilityVersion"("ownerId");

-- CreateIndex
CREATE INDEX "InventoryVisibilityVersion_versionKey_idx" ON "InventoryVisibilityVersion"("versionKey");

-- CreateIndex
CREATE INDEX "InventoryVisibilityVersion_visibility_idx" ON "InventoryVisibilityVersion"("visibility");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryVisibilityVersion_ownerId_versionKey_key" ON "InventoryVisibilityVersion"("ownerId", "versionKey");

-- CreateIndex
CREATE INDEX "InventoryVisibilityInstance_ownerId_idx" ON "InventoryVisibilityInstance"("ownerId");

-- CreateIndex
CREATE INDEX "InventoryVisibilityInstance_instanceId_idx" ON "InventoryVisibilityInstance"("instanceId");

-- CreateIndex
CREATE INDEX "InventoryVisibilityInstance_visibility_idx" ON "InventoryVisibilityInstance"("visibility");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryVisibilityInstance_ownerId_instanceId_key" ON "InventoryVisibilityInstance"("ownerId", "instanceId");

-- CreateIndex
CREATE INDEX "Listing_sellerId_idx" ON "Listing"("sellerId");

-- CreateIndex
CREATE INDEX "Listing_status_idx" ON "Listing"("status");

-- CreateIndex
CREATE INDEX "Listing_kind_idx" ON "Listing"("kind");

-- CreateIndex
CREATE INDEX "ListingLine_listingId_idx" ON "ListingLine"("listingId");

-- CreateIndex
CREATE INDEX "ListingLine_versionKey_idx" ON "ListingLine"("versionKey");

-- CreateIndex
CREATE INDEX "ListingLineInstance_listingId_idx" ON "ListingLineInstance"("listingId");

-- CreateIndex
CREATE INDEX "ListingLineInstance_instanceId_idx" ON "ListingLineInstance"("instanceId");

-- CreateIndex
CREATE INDEX "Order_buyerId_idx" ON "Order"("buyerId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

-- CreateIndex
CREATE INDEX "OrderLine_listingId_idx" ON "OrderLine"("listingId");

-- CreateIndex
CREATE INDEX "OrderLine_versionKey_idx" ON "OrderLine"("versionKey");

-- CreateIndex
CREATE INDEX "OrderLine_instanceId_idx" ON "OrderLine"("instanceId");

-- CreateIndex
CREATE INDEX "InventoryTransfer_fromUserId_idx" ON "InventoryTransfer"("fromUserId");

-- CreateIndex
CREATE INDEX "InventoryTransfer_toUserId_idx" ON "InventoryTransfer"("toUserId");

-- CreateIndex
CREATE INDEX "InventoryTransfer_orderId_idx" ON "InventoryTransfer"("orderId");

-- CreateIndex
CREATE INDEX "InventoryTransfer_status_idx" ON "InventoryTransfer"("status");

-- CreateIndex
CREATE INDEX "InventoryTransfer_createdAt_idx" ON "InventoryTransfer"("createdAt");
