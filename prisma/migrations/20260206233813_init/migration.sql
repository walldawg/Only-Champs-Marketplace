-- prisma/migrations/20260211190000_engine_core_v1/migration.sql
-- Engine Core v1 — Prisma-backed persistence for Games/Players/Events

PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS "Game" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "modeCode" TEXT,
  "status" TEXT NOT NULL DEFAULT 'LOBBY',
  "state" JSON NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "GamePlayer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "gameId" TEXT NOT NULL,
  "seat" INTEGER NOT NULL,
  "deckId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GamePlayer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "GameEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "gameId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSON NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorSeat" INTEGER,
  CONSTRAINT "GameEvent_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "GamePlayer_gameId_seat_key" ON "GamePlayer"("gameId", "seat");
CREATE INDEX IF NOT EXISTS "GamePlayer_deckId_idx" ON "GamePlayer"("deckId");

CREATE UNIQUE INDEX IF NOT EXISTS "GameEvent_gameId_seq_key" ON "GameEvent"("gameId", "seq");
CREATE INDEX IF NOT EXISTS "GameEvent_gameId_createdAt_idx" ON "GameEvent"("gameId", "createdAt");
CREATE INDEX IF NOT EXISTS "GameEvent_type_idx" ON "GameEvent"("type");

CREATE INDEX IF NOT EXISTS "Game_status_idx" ON "Game"("status");
CREATE INDEX IF NOT EXISTS "Game_modeCode_idx" ON "Game"("modeCode");

PRAGMA foreign_keys=ON;
