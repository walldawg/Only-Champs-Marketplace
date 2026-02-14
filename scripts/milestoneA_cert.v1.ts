// scripts/milestoneA_cert.v1.ts
// Milestone A — A12 Certification Suite (deterministic engine)
// Runs:
///  1) 100 deterministic replays (assert equality)
///  2) Post-Setup pointer mutation guard (must throw)
///  3) A7 gate violation smoke checks (must throw cleanly)
//
// Usage:
//   npx -y tsx scripts/milestoneA_cert.v1.ts
//
// Exit code:
//   0 = PASS
//   1 = FAIL

import crypto from "node:crypto";

import {
  loadAppConfigDefault,
  loadFormatRegistryDefault,
  loadGameModeRegistryDefault,
} from "../src/config/registryLoaders.v1";

import { assertDeterministicReplayV1 } from "../src/engine/replayHarness.v1";
import { SessionV1 } from "../src/engine/session.v1";
import { validateSessionCanEnterSetup } from "../src/config/sessionGate.v1";

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function assertThrows(fn: () => void, label: string, mustInclude?: string) {
  try {
    fn();
    fail(`${label}: expected throw, got success`);
  } catch (e: any) {
    const m = String(e?.message ?? "");
    if (mustInclude && !m.includes(mustInclude)) {
      fail(`${label}: error mismatch. expected to include "${mustInclude}", got "${m}"`);
    }
  }
}

function main() {
  const appConfig = loadAppConfigDefault();
  const formatRegistry = loadFormatRegistryDefault();
  const gameModeRegistry = loadGameModeRegistryDefault();

  // -----------------------------
  // 1) 100 deterministic replays
  // -----------------------------
  const N = 100;
  for (let i = 0; i < N; i++) {
    const inputs = {
      sessionId: newId("S_CERT"),
      matchId: newId("M_CERT"),
      pointer: {
        format: { formatId: "FMT_ROOKIE", formatVersion: 1 },
        gameMode: { gameModeId: "GM_SCORED", gameModeVersion: 1 },
      },
    };

    const diff = assertDeterministicReplayV1({
      inputs,
      appConfig,
      formatRegistry,
      gameModeRegistry,
    });

    if (!diff.ok) {
      console.error("Determinism diff report:");
      console.error(JSON.stringify(diff, null, 2));
      fail(`Determinism failed at iteration ${i + 1}/${N}`);
    }
  }
  console.log(`PASS: Determinism (A11) — ${N}/${N} replays identical`);

  // -------------------------------------------
  // 2) Post-Setup pointer mutation must be blocked
  // -------------------------------------------
  {
    const s = new SessionV1({
      sessionId: newId("S_MUT"),
      pointer: {
        format: { formatId: "FMT_ROOKIE", formatVersion: 1 },
        gameMode: { gameModeId: "GM_SCORED", gameModeVersion: 1 },
      },
    });

    s.beginSetup({ appConfig, formatRegistry, gameModeRegistry });

    assertThrows(
      () => s.setFormatPointer({ formatId: "FMT_ROOKIE", formatVersion: 1 }),
      "A8 post-setup mutation guard (format)",
      "SESSION_MUTATION_FORBIDDEN_POST_SETUP"
    );

    assertThrows(
      () => s.setGameModePointer({ gameModeId: "GM_SCORED", gameModeVersion: 1 }),
      "A8 post-setup mutation guard (gamemode)",
      "SESSION_MUTATION_FORBIDDEN_POST_SETUP"
    );

    console.log("PASS: Post-Setup mutation guard (A8)");
  }

  // -------------------------------------------
  // 3) Gate violation smoke checks (A7)
  // -------------------------------------------
  {
    // Format not found
    assertThrows(
      () =>
        validateSessionCanEnterSetup({
          appConfig,
          formatRegistry,
          gameModeRegistry,
          session: {
            format: { formatId: "FMT_DOES_NOT_EXIST", formatVersion: 1 },
            gameMode: { gameModeId: "GM_SCORED", gameModeVersion: 1 },
          },
        }),
      "A7 gate violation (format not found)",
      "FORMAT_NOT_FOUND"
    );

    // GameMode not found
    assertThrows(
      () =>
        validateSessionCanEnterSetup({
          appConfig,
          formatRegistry,
          gameModeRegistry,
          session: {
            format: { formatId: "FMT_ROOKIE", formatVersion: 1 },
            gameMode: { gameModeId: "GM_DOES_NOT_EXIST", gameModeVersion: 1 },
          },
        }),
      "A7 gate violation (gamemode not found)",
      "GAMEMODE_NOT_FOUND"
    );

    console.log("PASS: Gate violation smoke checks (A7)");
  }

  console.log("✅ MILESTONE A CERT SUITE PASS (A12)");
}

main();
