// scripts/milestoneA_certify.ts
// Milestone A: A12 certification — 100 deterministic replays must match.
// Run: npx -y tsx scripts/milestoneA_certify.ts

import {
  loadAppConfigDefault,
  loadFormatRegistryDefault,
  loadGameModeRegistryDefault,
} from "../src/config/registryLoaders.v1";
import { assertDeterministicReplayV1 } from "../src/engine/replayHarness.v1";

function main() {
  const app = loadAppConfigDefault();
  const fr = loadFormatRegistryDefault();
  const gr = loadGameModeRegistryDefault();

  const failures: Array<{ i: number; diffs: string[] }> = [];

  for (let i = 1; i <= 100; i++) {
    const inputs = {
      sessionId: `S_CERT_${i}`,
      matchId: `M_CERT_${i}`,
      pointer: {
        format: { formatId: "FMT_ROOKIE", formatVersion: 1 },
        gameMode: { gameModeId: "GM_SCORED", gameModeVersion: 1 },
      },
    };

    const out = assertDeterministicReplayV1({
      inputs,
      appConfig: app,
      formatRegistry: fr,
      gameModeRegistry: gr,
    });

    if (!out.ok) failures.push({ i, diffs: out.diffs });
  }

  if (failures.length > 0) {
    console.error(`Milestone A CERT FAIL: ${failures.length}/100 failed`);
    for (const f of failures.slice(0, 10)) {
      console.error(`- Case ${f.i}: ${f.diffs.join("; ")}`);
    }
    process.exit(1);
  }

  console.log("Milestone A CERT PASS: 100/100 deterministic replays matched");
  process.exit(0);
}

main();
