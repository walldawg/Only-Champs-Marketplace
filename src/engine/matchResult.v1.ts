// src/engine/matchResult.v1.ts
// Match Result Record builder (post-COMPLETE).
// Milestone B (B1): include contract-compliant timeline (MatchTimelineEventV1[]).
//
// Patch v0.3:
// - Ensure timeline events carry required lifecycle vocabulary fields in `extra`,
//   including rulesetId (bound ruleset pointer) for downstream consumers.
// - Also ensure deterministic identity fields are present in `extra`:
//     matchId, seed, rulesetSnapshotHash, setupSnapshotHash
// - No gameplay changes. Deterministic only.

import { SessionV1 } from "./session.v1";
import type { MatchTimelineEventV1, JSONObject } from "../contracts/gameplay/v1/MatchArtifactV1";

export type WinReasonV1 = string;

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

function ensureObj(v: any): Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as any) : {};
}

export function buildMatchResultRecordV1(args: { matchId: string; session: SessionV1 }): MatchResultRecordV1 {
  if (args.session.phase !== "COMPLETE") {
    throw new Error(`MATCH_RESULT_BAD_PHASE: session not COMPLETE (is ${args.session.phase})`);
  }
  const snaps = args.session.snapshots;
  if (!snaps) throw new Error("MATCH_RESULT_MISSING_SNAPSHOTS");

  const outcome = args.session.battleOutcome;
  if (!outcome) throw new Error("MATCH_RESULT_MISSING_BATTLE_OUTCOME");

  // Deterministic identity + snapshots (fallback-safe).
  const matchIdExtra =
    (args.session as any).getMatchIdForTimeline?.() ??
    (args.session as any).getMatchId?.() ??
    (args.session as any).matchId ??
    args.matchId ??
    null;

  const seedExtra =
    (args.session as any).getSeedForTimeline?.() ??
    (args.session as any).getMatchSeed?.() ??
    (args.session as any).matchSeed ??
    null;

  const rulesetSnapshotHashExtra =
    typeof (args.session as any).rulesetSnapshotHash === "function" ? (args.session as any).rulesetSnapshotHash() : null;

  const setupSnapshotHashExtra =
    typeof (args.session as any).setupSnapshotHash === "function" ? (args.session as any).setupSnapshotHash() : null;

  // Normalize timeline extras to include deterministic required fields for consumers.
  const rulesetId = (args.session as any).rulesetId ?? "UNBOUND";

  const timeline = args.session.timeline.map((e) => {
    const extra = ensureObj((e as any).extra);

    // Only fill missing fields; never overwrite existing.
    const nextExtra: JSONObject = {
      ...extra,
      rulesetId: extra.rulesetId ?? rulesetId,
      matchId: extra.matchId ?? matchIdExtra,
      seed: extra.seed ?? seedExtra,
      rulesetSnapshotHash: extra.rulesetSnapshotHash ?? rulesetSnapshotHashExtra,
      setupSnapshotHash: extra.setupSnapshotHash ?? setupSnapshotHashExtra,
    } as any;

    return {
      idx: e.idx,
      code: e.code,
      at: e.at,
      participantId: e.participantId,
      metrics: e.metrics,
      extra: nextExtra,
    } as MatchTimelineEventV1;
  });

  const record: MatchResultRecordV1 = {
    matchId: args.matchId,
    sessionId: args.session.sessionId,

    formatId: snaps.formatSnapshot.formatId,
    formatVersion: snaps.formatSnapshot.formatVersion,

    gameModeId: snaps.gameModeSnapshot.gameModeId,
    gameModeVersion: snaps.gameModeSnapshot.gameModeVersion,

    engineCompatVersion: snaps.formatSnapshot.engineCompatVersion,

    timeline,

    result: {
      winner: (outcome as any).winner,
      winReason: (outcome as any).winReason,
      totalBattles: (outcome as any).totalBattles,
      finalCoinCount: (outcome as any).finalCoinCount,
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
