// src/store/replayFromStore.v1.ts
// Milestone C (C1/C2): Replay-from-stored artifacts and compare outcomes.
// IMPORTANT: replay must use the original stored sessionId + matchId,
// because deterministic outcomes depend on them.

import type { AppConfig, FormatRegistry, GameModeRegistry } from "../config/registryLoaders.v1";
import { replayOnceV1 } from "../engine/replayHarness.v1";
import type { StoredMatchV1 } from "./matchStore.memory.v1";

export type StoreReplayDiffV1 = {
  ok: boolean;
  diffs: string[];
};

export function replayFromStoredAndCompareV1(args: {
  stored: StoredMatchV1;
  appConfig: AppConfig;
  formatRegistry: FormatRegistry;
  gameModeRegistry: GameModeRegistry;
}): StoreReplayDiffV1 {
  // Re-run from stored inputs using ORIGINAL ids (determinism key)
  const rerun = replayOnceV1({
    inputs: {
      sessionId: args.stored.sessionId,
      matchId: args.stored.matchId,
      pointer: args.stored.pointer,
    },
    appConfig: args.appConfig,
    formatRegistry: args.formatRegistry,
    gameModeRegistry: args.gameModeRegistry,
  });

  const diffs: string[] = [];

  if (args.stored.matchResult.formatId !== rerun.formatId)
    diffs.push(`formatId: ${args.stored.matchResult.formatId} !== ${rerun.formatId}`);
  if (args.stored.matchResult.formatVersion !== rerun.formatVersion)
    diffs.push(`formatVersion: ${args.stored.matchResult.formatVersion} !== ${rerun.formatVersion}`);

  if (args.stored.matchResult.gameModeId !== rerun.gameModeId)
    diffs.push(`gameModeId: ${args.stored.matchResult.gameModeId} !== ${rerun.gameModeId}`);
  if (args.stored.matchResult.gameModeVersion !== rerun.gameModeVersion)
    diffs.push(`gameModeVersion: ${args.stored.matchResult.gameModeVersion} !== ${rerun.gameModeVersion}`);

  const a = args.stored.matchResult.result;
  const b = rerun.result;

  if (a.winner !== b.winner) diffs.push(`winner: ${a.winner} !== ${b.winner}`);
  if (a.winReason !== b.winReason) diffs.push(`winReason: ${a.winReason} !== ${b.winReason}`);
  if (a.totalBattles !== b.totalBattles) diffs.push(`totalBattles: ${a.totalBattles} !== ${b.totalBattles}`);

  const aCoins = JSON.stringify(a.finalCoinCount ?? null);
  const bCoins = JSON.stringify(b.finalCoinCount ?? null);
  if (aCoins !== bCoins) diffs.push(`finalCoinCount: ${aCoins} !== ${bCoins}`);

  return { ok: diffs.length === 0, diffs };
}
