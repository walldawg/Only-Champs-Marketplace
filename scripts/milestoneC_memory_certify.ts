// scripts/milestoneC_memory_certify.ts
// Milestone C (C1): In-memory persistence + replay-from-store must match 100/100.
// Run: npx -y tsx scripts/milestoneC_memory_certify.ts

import {
  loadAppConfigDefault,
  loadFormatRegistryDefault,
  loadGameModeRegistryDefault,
} from "../src/config/registryLoaders.v1";

import { replayOnceV1 } from "../src/engine/replayHarness.v1";
import { buildPostGameBundleV1 } from "../src/postgame/postGameBundle.v1";
import { MatchStoreMemoryV1 } from "../src/store/matchStore.memory.v1";
import { replayFromStoredAndCompareV1 } from "../src/store/replayFromStore.v1";

function main() {
  const app = loadAppConfigDefault();
  const fr = loadFormatRegistryDefault();
  const gr = loadGameModeRegistryDefault();

  const store = new MatchStoreMemoryV1();

  const failures: Array<{ i: number; diffs: string[] }> = [];

  for (let i = 1; i <= 100; i++) {
    const inputs = {
      sessionId: `S_C_CERT_${i}`,
      matchId: `M_C_CERT_${i}`,
      pointer: {
        format: { formatId: "FMT_ROOKIE", formatVersion: 1 },
        gameMode: { gameModeId: "GM_SCORED", gameModeVersion: 1 },
      },
    };

    // Run + build bundle
    const matchResult = replayOnceV1({ inputs, appConfig: app, formatRegistry: fr, gameModeRegistry: gr });
    const bundle = buildPostGameBundleV1({ matchResult });

    // Persist full audit object
    store.save({
      matchId: matchResult.matchId,
      sessionId: matchResult.sessionId,
      pointer: inputs.pointer,
      snapshots: {
        // session snapshots are already embedded in matchResult via ids; but we persist snapshots for audit anyway.
        // For now, we use the same values available from matchResult (placeholders are fine for plumbing).
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
      },
      matchResult,
      insightRecord: bundle.insightRecord,
      createdAtIso: new Date().toISOString(),
    });

    // Replay from stored & compare
    const stored = store.get(matchResult.matchId);
    const diff = replayFromStoredAndCompareV1({ stored, appConfig: app, formatRegistry: fr, gameModeRegistry: gr });
    if (!diff.ok) failures.push({ i, diffs: diff.diffs });
  }

  if (failures.length > 0) {
    console.error(`Milestone C (memory) CERT FAIL: ${failures.length}/100 failed`);
    for (const f of failures.slice(0, 10)) {
      console.error(`- Case ${f.i}: ${f.diffs.join("; ")}`);
    }
    process.exit(1);
  }

  console.log("Milestone C (memory) CERT PASS: 100/100 stored matches replayed identically");
  process.exit(0);
}

main();
