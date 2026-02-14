// src/engine/runner.v1.ts
// Deterministic phase runner + deterministic battle outcome (hash-based).
// Milestone B (B1): emit standardized timeline events with deterministic timestamps.

import type { AppConfig, FormatRegistry, GameModeRegistry } from "../config/registryLoaders.v1";
import { SessionV1, type BattleOutcomeV1 } from "./session.v1";
import crypto from "node:crypto";

export type RunResultV1 = {
  sessionId: string;
  phase: "COMPLETE";
};

function deterministicBattleOutcome(args: { sessionId: string; matchIdForDeterminism: string }): BattleOutcomeV1 {
  // Deterministic bytes from matchId (sessionId included as salt for safety)
  const h = crypto.createHash("sha256").update(`${args.matchIdForDeterminism}::${args.sessionId}`).digest();

  // totalBattles 1..9
  const totalBattles = (h[0] % 9) + 1;

  // winner from next byte: 0..2
  const w = h[1] % 3;
  const winner = w === 0 ? "HOME" : w === 1 ? "AWAY" : "DRAW";

  return { winner, totalBattles, winReason: "DETERMINISTIC_HASH_V1" };
}

// Milestone B1: deterministic ISO timestamps for timeline events.
// (No wall-clock time allowed, or determinism would break.)
function deterministicIso(args: { sessionId: string; matchIdForDeterminism: string; idx: number }): string {
  const h = crypto.createHash("sha256").update(`TS::${args.matchIdForDeterminism}::${args.sessionId}`).digest();

  // base epoch in ms (fixed), then add an offset derived from hash (within 24h) and idx spacing
  const baseEpochMs = 1700000000000; // fixed constant
  const offsetMs =
    (((h[2] << 24) | (h[3] << 16) | (h[4] << 8) | h[5]) >>> 0) % 86_400_000; // 0..(24h-1)
  const t = baseEpochMs + offsetMs + args.idx * 1000; // 1s spacing between events
  return new Date(t).toISOString();
}

export function runSessionV1(args: {
  session: SessionV1;
  appConfig: AppConfig;
  formatRegistry: FormatRegistry;
  gameModeRegistry: GameModeRegistry;
  // required to keep outcome deterministic across replays
  matchIdForDeterminism: string;
}): RunResultV1 {
  const at = (idx: number) => deterministicIso({ sessionId: args.session.sessionId, matchIdForDeterminism: args.matchIdForDeterminism, idx });

  // Universal lifecycle (minimal) — Spec v0 vocabulary subset
  // CREATED → SETUP
  if (args.session.phase === "CREATED") {
    args.session.appendTimelineEvent({ code: "LOAD_RULES", at: at(0), metrics: {} });
    args.session.appendTimelineEvent({ code: "SETUP_START", at: at(1), metrics: {} });

    args.session.beginSetup({
      appConfig: args.appConfig,
      formatRegistry: args.formatRegistry,
      gameModeRegistry: args.gameModeRegistry,
    });

    args.session.appendTimelineEvent({
      code: "SETUP_COMPLETE",
      at: at(2),
      metrics: { engineCompatVersion: args.session.snapshots?.formatSnapshot.engineCompatVersion ?? 0 },
    });

    args.session.appendTimelineEvent({ code: "MATCH_START", at: at(3), metrics: {} });
  }

  // SETUP → BATTLE_LOOP
  if (args.session.phase === "SETUP") {
    args.session.enterBattleLoop();
  }

  // BATTLE_LOOP → COMPLETE
  if (args.session.phase === "BATTLE_LOOP") {
    args.session.appendTimelineEvent({
      code: "BATTLE_START",
      at: at(4),
      metrics: { battleIndex: 1 },
      extra: { note: "Milestone B1 minimal battle loop (single deterministic outcome)" },
    });

    const outcome = deterministicBattleOutcome({
      sessionId: args.session.sessionId,
      matchIdForDeterminism: args.matchIdForDeterminism,
    });

    // RESOLVE (minimal)
    args.session.appendTimelineEvent({
      code: "RESOLVE",
      at: at(5),
      metrics: { totalBattles: outcome.totalBattles },
      extra: { winner: outcome.winner, winReason: outcome.winReason },
    });

    args.session.setBattleOutcome(outcome);
    args.session.complete();

    args.session.appendTimelineEvent({
      code: "MATCH_END",
      at: at(6),
      metrics: { totalBattles: outcome.totalBattles },
      extra: { winner: outcome.winner },
    });
  }

  if (args.session.phase !== "COMPLETE") {
    throw new Error(`SESSION_RUNNER_FAILED_TO_COMPLETE: ended at ${args.session.phase}`);
  }

  return { sessionId: args.session.sessionId, phase: "COMPLETE" };
}
