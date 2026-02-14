// src/postgame/postGameBundle.v1.ts
// Milestone B: B2 attachment layer (postgame bundle).
// Bundle is derived post-COMPLETE and must not affect replay.

import type { MatchResultRecordV1 } from "../engine/matchResult.v1";
import { buildInsightRecordV1, type InsightRecordV1 } from "../insights/insightEngine.v1";

export type PostGameBundleV1 = {
  matchResult: MatchResultRecordV1;
  insightRecord: InsightRecordV1;
};

export function buildPostGameBundleV1(args: {
  matchResult: MatchResultRecordV1;
}): PostGameBundleV1 {
  const insightRecord = buildInsightRecordV1({ matchResult: args.matchResult });

  const bundle: PostGameBundleV1 = {
    matchResult: args.matchResult,
    insightRecord,
  };

  return deepFreeze(bundle);
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
