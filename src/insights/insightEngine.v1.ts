// src/insights/insightEngine.v1.ts
// Milestone B: Pure insight engine (read-only).
// Input: MatchResultRecordV1 (post-COMPLETE artifact)
// Output: InsightRecordV1
// Must not mutate session or matchResult. Must not influence replay.

import type { MatchResultRecordV1 } from "../engine/matchResult.v1";

export type InsightV1 = {
  type: "MATCH_SUMMARY_V1";
  confidence: number; // 0..1
  explanationText: string; // coach tone, no advice, no authority
};

export type InsightRecordV1 = {
  matchId: string;
  insights: InsightV1[];
};

export function buildInsightRecordV1(args: { matchResult: MatchResultRecordV1 }): InsightRecordV1 {
  const r = args.matchResult;

  // Pure derivation from match result only (no gameplay mutation, no side effects).
  const summary: InsightV1 = {
    type: "MATCH_SUMMARY_V1",
    confidence: 1,
    explanationText: `Match completed. Winner: ${r.result.winner}. Battles: ${r.result.totalBattles}.`,
  };

  const record: InsightRecordV1 = {
    matchId: r.matchId,
    insights: [summary],
  };

  return deepFreeze(record);
}

// Ensure the insight artifact is immutable too
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
