// src/store/matchStore.memory.v1.ts
// Milestone C (C1): In-memory persistence for audit-grade artifact bundles.
// No Prisma yet.

import type { SessionPointer } from "../config/sessionGate.v1";
import type { MatchResultRecordV1 } from "../engine/matchResult.v1";
import type { InsightRecordV1 } from "../insights/insightEngine.v1";

export type StoredMatchV1 = {
  matchId: string;
  sessionId: string;

  // Inputs required to reconstruct / audit
  pointer: SessionPointer;

  // Frozen boundary artifacts
  snapshots: {
    formatSnapshot: {
      formatId: string;
      formatVersion: number;
      engineCompatVersion: number;
      name?: string;
      description?: string;
    };
    gameModeSnapshot: {
      gameModeId: string;
      gameModeVersion: number;
      engineCompatVersion: number;
      name?: string;
      description?: string;
      formatGate?: any;
    };
  };

  // Postgame artifacts
  matchResult: MatchResultRecordV1;
  insightRecord: InsightRecordV1;

  createdAtIso: string;
};

export class MatchStoreMemoryV1 {
  private byMatchId = new Map<string, StoredMatchV1>();

  save(record: StoredMatchV1) {
    if (this.byMatchId.has(record.matchId)) {
      throw new Error(`STORE_DUPLICATE_MATCH_ID: ${record.matchId}`);
    }
    // store frozen copy to prevent accidental mutation
    this.byMatchId.set(record.matchId, deepFreeze(structuredCloneCompat(record)));
  }

  get(matchId: string): StoredMatchV1 {
    const found = this.byMatchId.get(matchId);
    if (!found) throw new Error(`STORE_MATCH_NOT_FOUND: ${matchId}`);
    return found;
  }

  listMatchIds(): string[] {
    return Array.from(this.byMatchId.keys());
  }
}

// Node 20 supports structuredClone; keep a tiny compat for safety
function structuredCloneCompat<T>(obj: T): T {
  // @ts-ignore
  if (typeof structuredClone === "function") return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
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
