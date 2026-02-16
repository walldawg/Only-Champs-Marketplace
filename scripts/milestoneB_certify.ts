// scripts/milestoneB_certify.ts
// Milestone B: certification — insights/bundles must not affect determinism.
// Run: npx -y tsx scripts/milestoneB_certify.ts

import {
  loadAppConfigDefault,
  loadFormatRegistryDefault,
  loadGameModeRegistryDefault,
} from "../src/config/registryLoaders.v1";

import { replayOnceV1, assertDeterministicReplayV1 } from "../src/engine/replayHarness.v1";
import { buildPostGameBundleV1 } from "../src/postgame/postGameBundle.v1";

function main() {
  const app = loadAppConfigDefault();
  const fr = loadFormatRegistryDefault();
  const gr = loadGameModeRegistryDefault();

  const failures: Array<{ i: number; diffs: string[] }> = [];

  for (let i = 1; i <= 100; i++) {
    const inputs = {
      sessionId: `S_B_CERT_${i}`,
      matchId: `M_B_CERT_${i}`,
      pointer: {
        format: { formatId: "FMT_ROOKIE", formatVersion: 1 },
        gameMode: { gameModeId: "GM_SCORED", gameModeVersion: 1 },
      },
    };

    // Build match + bundle postgame
    const rec = replayOnceV1({ inputs, appConfig: app, formatRegistry: fr, gameModeRegistry: gr });
    buildPostGameBundleV1({ matchResult: rec });

    // Determinism must still hold
    const out = assertDeterministicReplayV1({ inputs, appConfig: app, formatRegistry: fr, gameModeRegistry: gr });
    if (!out.ok) failures.push({ i, diffs: out.diffs });
  }

  if (failures.length > 0) {
    console.error(`Milestone B CERT FAIL: ${failures.length}/100 failed`);
    for (const f of failures.slice(0, 10)) {
      console.error(`- Case ${f.i}: ${f.diffs.join("; ")}`);
    }
    process.exit(1);
  }

  console.log("Milestone B CERT PASS: 100/100 replays matched with insights attached");
  process.exit(0);
}

main();
