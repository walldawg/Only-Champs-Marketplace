// src/engine/matchResult.v1.ts
// Match Result Record builder (post-COMPLETE) — uses deterministic battle outcome.
// Milestone B (B1): include contract-compliant timeline (MatchTimelineEventV1[]).

import { SessionV1 } from "./session.v1";
import type { MatchTimelineEventV1 } from "../contracts/gameplay/v1/MatchArtifactV1";

export type WinReasonV1 = "DETERMINISTIC_HASH_V1";

export type MatchResultRecordV1 = {
  matchId: string;
  sessionId: string;

  formatId: string;
  formatVersion: number;

  gameModeId: string;
  gameModeVersion: number;

  engineCompatVersion: number;

  // Milestone B1: standardized timeline events emitted by the engine runner.
  timeline: MatchTimelineEventV1[];

  result: {
    winner: "HOME" | "AWAY" | "DRAW";
    winReason: WinReasonV1;
    totalBattles: number;
    finalCoinCount?: { home: number; away: number };
  };
};

export function buildMatchResultRecordV1(args: {
  matchId: string;
  session: SessionV1;
}): MatchResultRecordV1 {
  if (args.session.phase !== "COMPLETE") {
    throw new Error(`MATCH_RESULT_BAD_PHASE: session not COMPLETE (is ${args.session.phase})`);
  }
  const snaps = args.session.snapshots;
  if (!snaps) throw new Error("MATCH_RESULT_MISSING_SNAPSHOTS");

  const outcome = args.session.battleOutcome;
  if (!outcome) throw new Error("MATCH_RESULT_MISSING_BATTLE_OUTCOME");

  const record: MatchResultRecordV1 = {
    matchId: args.matchId,
    sessionId: args.session.sessionId,

    formatId: snaps.formatSnapshot.formatId,
    formatVersion: snaps.formatSnapshot.formatVersion,

    gameModeId: snaps.gameModeSnapshot.gameModeId,
    gameModeVersion: snaps.gameModeSnapshot.gameModeVersion,

    engineCompatVersion: snaps.formatSnapshot.engineCompatVersion,

    timeline: args.session.timeline.slice(),

    result: {
      winner: outcome.winner,
      winReason: outcome.winReason,
      totalBattles: outcome.totalBattles,
    },
  };

  return deepFreeze(record);
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object") {
    Object.freeze(obj);
    // @ts-ignore
    for (const key of Object.keys(obj)) {
      // @ts-ignore
      const v = obj[key];
      if (v && typeof v === "object" && !Object.isFrozen(v)) deepFreeze(v);
    }
  }
  return obj;
}
