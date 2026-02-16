/*
  Warnings:

  - You are about to alter the column `state` on the `Game` table. The data in that column could be lost. The data in that column will be cast from `Unsupported("json")` to `Json`.
  - You are about to alter the column `payload` on the `GameEvent` table. The data in that column could be lost. The data in that column will be cast from `Unsupported("json")` to `Json`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameEvent_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GameEvent" ("actorSeat", "createdAt", "gameId", "id", "payload", "seq", "type") SELECT "actorSeat", "createdAt", "gameId", "id", "payload", "seq", "type" FROM "GameEvent";
DROP TABLE "GameEvent";
ALTER TABLE "new_GameEvent" RENAME TO "GameEvent";
CREATE INDEX "GameEvent_gameId_createdAt_idx" ON "GameEvent"("gameId", "createdAt");
CREATE INDEX "GameEvent_type_idx" ON "GameEvent"("type");
CREATE UNIQUE INDEX "GameEvent_gameId_seq_key" ON "GameEvent"("gameId", "seq");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
