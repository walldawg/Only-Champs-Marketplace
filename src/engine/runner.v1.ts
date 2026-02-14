// src/engine/runner.v1.ts
// Deterministic phase runner + deterministic battle outcome (hash-based).

import type { AppConfig, FormatRegistry, GameModeRegistry } from "../config/registryLoaders.v1";
import { SessionV1, type BattleOutcomeV1 } from "./session.v1";
import crypto from "node:crypto";

export type RunResultV1 = {
  sessionId: string;
  phase: "COMPLETE";
};

function deterministicBattleOutcome(args: { sessionId: string; matchIdForDeterminism: string }): BattleOutcomeV1 {
  // Deterministic bytes from matchId (sessionId included as salt for safety)
  const h = crypto
    .createHash("sha256")
    .update(`${args.matchIdForDeterminism}::${args.sessionId}`)
    .digest();

  // totalBattles 1..9
  const totalBattles = (h[0] % 9) + 1;

  // winner from next byte: 0..2
  const w = h[1] % 3;
  const winner = w === 0 ? "HOME" : w === 1 ? "AWAY" : "DRAW";

  return { winner, totalBattles, winReason: "DETERMINISTIC_HASH_V1" };
}

export function runSessionV1(args: {
  session: SessionV1;
  appConfig: AppConfig;
  formatRegistry: FormatRegistry;
  gameModeRegistry: GameModeRegistry;
  // new: required to keep outcome deterministic across replays
  matchIdForDeterminism: string;
}): RunResultV1 {
  // CREATED → SETUP
  if (args.session.phase === "CREATED") {
    args.session.beginSetup({
      appConfig: args.appConfig,
      formatRegistry: args.formatRegistry,
      gameModeRegistry: args.gameModeRegistry,
    });
  }

  // SETUP → BATTLE_LOOP
  if (args.session.phase === "SETUP") {
    args.session.enterBattleLoop();
  }

  // BATTLE_LOOP → COMPLETE
  if (args.session.phase === "BATTLE_LOOP") {
    const outcome = deterministicBattleOutcome({
      sessionId: args.session.sessionId,
      matchIdForDeterminism: args.matchIdForDeterminism,
    });
    args.session.setBattleOutcome(outcome);
    args.session.complete();
  }

  if (args.session.phase !== "COMPLETE") {
    throw new Error(`SESSION_RUNNER_FAILED_TO_COMPLETE: ended at ${args.session.phase}`);
  }

  return { sessionId: args.session.sessionId, phase: "COMPLETE" };
}
