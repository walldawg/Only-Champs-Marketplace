// scripts/milestoneC_db_certify.ts
// Milestone C2: Prisma/SQLite persistence + replay-from-DB must match 100/100.
// Run: npx -y tsx scripts/milestoneC_db_certify.ts

import { PrismaClient } from "@prisma/client";

import {
  loadAppConfigDefault,
  loadFormatRegistryDefault,
  loadGameModeRegistryDefault,
} from "../src/config/registryLoaders.v1";

import { replayOnceV1 } from "../src/engine/replayHarness.v1";
import { buildPostGameBundleV1 } from "../src/postgame/postGameBundle.v1";
import { replayFromStoredAndCompareV1 } from "../src/store/replayFromStore.v1";

const prisma = new PrismaClient();

async function main() {
  const app = loadAppConfigDefault();
  const fr = loadFormatRegistryDefault();
  const gr = loadGameModeRegistryDefault();

  // optional: keep runs repeatable by clearing prior cert rows
  await prisma.engineMatchArtifactV1.deleteMany({
    where: { matchId: { startsWith: "M_CDB_CERT_" } },
  });

  const failures: Array<{ i: number; diffs: string[] }> = [];

  for (let i = 1; i <= 100; i++) {
    const inputs = {
      sessionId: `S_CDB_CERT_${i}`,
      matchId: `M_CDB_CERT_${i}`,
      pointer: {
        format: { formatId: "FMT_ROOKIE", formatVersion: 1 },
        gameMode: { gameModeId: "GM_SCORED", gameModeVersion: 1 },
      },
    };

    const matchResult = replayOnceV1({
      inputs,
      appConfig: app,
      formatRegistry: fr,
      gameModeRegistry: gr,
    });

    const bundle = buildPostGameBundleV1({ matchResult });

    await prisma.engineMatchArtifactV1.create({
      data: {
        matchId: matchResult.matchId,
        sessionId: matchResult.sessionId,
        formatId: matchResult.formatId,
        formatVersion: matchResult.formatVersion,
        gameModeId: matchResult.gameModeId,
        gameModeVersion: matchResult.gameModeVersion,
        engineCompatVersion: matchResult.engineCompatVersion,

        pointerJson: inputs.pointer as any,
        snapshotsJson: {
          formatSnapshot: {
            formatId: matchResult.formatId,
            formatVersion: matchResult.formatVersion,
            engineCompatVersion: matchResult.engineCompatVersion,
          },
          gameModeSnapshot: {
            gameModeId: matchResult.gameModeId,
            gameModeVersion: matchResult.gameModeVersion,
            engineCompatVersion: matchResult.engineCompatVersion,
          },
        } as any,
        matchResultJson: matchResult as any,
        insightRecordJson: bundle.insightRecord as any,
      },
    });

    const row = await prisma.engineMatchArtifactV1.findUnique({
      where: { matchId: matchResult.matchId },
    });

    if (!row) {
      failures.push({ i, diffs: ["DB_READBACK_FAILED"] });
      continue;
    }

    // Convert DB row → StoredMatchV1 shape expected by replayFromStoredAndCompareV1
    const stored = {
      matchId: row.matchId,
      sessionId: row.sessionId,
      pointer: row.pointerJson as any,
      snapshots: row.snapshotsJson as any,
      matchResult: row.matchResultJson as any,
      insightRecord: row.insightRecordJson as any,
      createdAtIso: row.createdAt.toISOString(),
    };

    const diff = replayFromStoredAndCompareV1({
      stored,
      appConfig: app,
      formatRegistry: fr,
      gameModeRegistry: gr,
    });

    if (!diff.ok) failures.push({ i, diffs: diff.diffs });
  }

  if (failures.length > 0) {
    console.error(`Milestone C2 (db) CERT FAIL: ${failures.length}/100 failed`);
    for (const f of failures.slice(0, 10)) {
      console.error(`- Case ${f.i}: ${f.diffs.join("; ")}`);
    }
    process.exit(1);
  }

  console.log("Milestone C2 (db) CERT PASS: 100/100 stored DB matches replayed identically");
  process.exit(0);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
