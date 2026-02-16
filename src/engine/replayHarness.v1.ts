// src/engine/replayHarness.v1.ts
// Milestone A: A11 deterministic replay harness.
// Given the same inputs, we must produce identical MatchResult fields.

import type { AppConfig, FormatRegistry, GameModeRegistry } from "../config/registryLoaders.v1";
import type { SessionPointer } from "../config/sessionGate.v1";
import { SessionV1 } from "./session.v1";
import { runSessionV1 } from "./runner.v1";
import { buildMatchResultRecordV1, type MatchResultRecordV1 } from "./matchResult.v1";

export type ReplayInputsV1 = {
  sessionId: string;
  matchId: string;
  pointer: SessionPointer & { ruleset?: { ruleSetKey: string; ruleSetVersion: number } | null };
  ruleSetJson?: any | null;
};

export type ReplayDiffV1 = {
  ok: boolean;
  diffs: string[];
  a: Pick<MatchResultRecordV1["result"], "winner" | "winReason" | "totalBattles" | "finalCoinCount">;
  b: Pick<MatchResultRecordV1["result"], "winner" | "winReason" | "totalBattles" | "finalCoinCount">;
};

function pickResult(r: MatchResultRecordV1) {
  return {
    winner: r.result.winner,
    winReason: r.result.winReason,
    totalBattles: r.result.totalBattles,
    finalCoinCount: r.result.finalCoinCount,
  };
}

export function replayOnceV1(args: {
  inputs: ReplayInputsV1;
  appConfig: AppConfig;
  formatRegistry: FormatRegistry;
  gameModeRegistry: GameModeRegistry;
}): MatchResultRecordV1 {
  const s = new SessionV1({ sessionId: args.inputs.sessionId, pointer: args.inputs.pointer as any, ruleSetJson: args.inputs.ruleSetJson ?? null });
  runSessionV1({
    session: s,
    appConfig: args.appConfig,
    formatRegistry: args.formatRegistry,
    gameModeRegistry: args.gameModeRegistry,
    matchIdForDeterminism: args.inputs.matchId,
    ruleSetJson: args.inputs.ruleSetJson ?? null,
  });

  return buildMatchResultRecordV1({ matchId: args.inputs.matchId, session: s });
}

export function assertDeterministicReplayV1(args: {
  inputs: ReplayInputsV1;
  appConfig: AppConfig;
  formatRegistry: FormatRegistry;
  gameModeRegistry: GameModeRegistry;
}): ReplayDiffV1 {
  const r1 = replayOnceV1(args);
  const r2 = replayOnceV1(args);

  const a = pickResult(r1);
  const b = pickResult(r2);

  const diffs: string[] = [];
  if (a.winner !== b.winner) diffs.push(`winner: ${a.winner} !== ${b.winner}`);
  if (a.winReason !== b.winReason) diffs.push(`winReason: ${a.winReason} !== ${b.winReason}`);
  if (a.totalBattles !== b.totalBattles) diffs.push(`totalBattles: ${a.totalBattles} !== ${b.totalBattles}`);

  const aCoins = JSON.stringify(a.finalCoinCount ?? null);
  const bCoins = JSON.stringify(b.finalCoinCount ?? null);
  if (aCoins !== bCoins) diffs.push(`finalCoinCount: ${aCoins} !== ${bCoins}`);

  return { ok: diffs.length === 0, diffs, a, b };
}
