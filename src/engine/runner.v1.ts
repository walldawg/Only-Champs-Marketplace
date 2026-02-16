// src/engine/runner.v1.ts
// Deterministic match lifecycle runner — Spec v0.3 (LOCKED).
// Implements: LOAD_RULES → SETUP_MODE → RUN_REGULATION → (IF NO WINNER) RUN_TIEBREAK(SUDDEN_DEATH|ALLOW_TIE) → END_MATCH
//
// NOTE:
// - No wall-clock timestamps.
// - matchSeed is the sole entropy source; all derived randomness must come from it.
// - Timeline events must follow Spec v0.3 vocabulary + required payload envelope (stored in event.extra).

import type { AppConfig, FormatRegistry, GameModeRegistry } from "../config/registryLoaders.v1";
import { SessionV1 } from "./session.v1";
import crypto from "node:crypto";

export type RunResultV1 = {
  sessionId: string;
  phase: "COMPLETE";
};

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function u32FromHex(hex: string, byteOffset: number): number {
  const b0 = parseInt(hex.slice(byteOffset * 2 + 0, byteOffset * 2 + 2), 16) & 0xff;
  const b1 = parseInt(hex.slice(byteOffset * 2 + 2, byteOffset * 2 + 4), 16) & 0xff;
  const b2 = parseInt(hex.slice(byteOffset * 2 + 4, byteOffset * 2 + 6), 16) & 0xff;
  const b3 = parseInt(hex.slice(byteOffset * 2 + 6, byteOffset * 2 + 8), 16) & 0xff;
  return (((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0) >>> 0;
}

function deterministicIsoFromSeed(matchSeed: string, idx: number): string {
  const h = sha256Hex(`TS::${matchSeed}`);
  const baseEpochMs = 1700000000000; // fixed constant
  const offsetMs = u32FromHex(h, 0) % 86_400_000; // within 24h
  const t = baseEpochMs + offsetMs + idx * 1000; // 1s spacing
  return new Date(t).toISOString();
}

function coinFlipFirstPlayer(matchSeed: string): "LS" | "OP" {
  const h = sha256Hex(`${matchSeed}::coin`);
  return (u32FromHex(h, 0) % 2) === 0 ? "LS" : "OP";
}

function outcomeForBattle(args: { matchSeed: string; battleIndex: number }): "LS" | "OP" | "TIE" {
  const h = sha256Hex(`${args.matchSeed}::battle::${args.battleIndex}`);
  const v = u32FromHex(h, 0) % 3;
  return v === 0 ? "LS" : v === 1 ? "OP" : "TIE";
}

function outcomeForSuddenDeathRound(args: { matchSeed: string; sdRound: number }): "LS" | "OP" | "TIE" {
  const h = sha256Hex(`${args.matchSeed}::sd::round::${args.sdRound}`);
  const v = u32FromHex(h, 0) % 3;
  return v === 0 ? "LS" : v === 1 ? "OP" : "TIE";
}

function heroRefFor(args: { matchSeed: string; side: "LS" | "OP"; drawIndex: number }): string {
  // Spec: heroSeed_{side} = hash(matchSeed + 'hero_{side}')
  const seed = sha256Hex(`${args.matchSeed}::hero_${args.side}`);
  // Deterministically name a ref from the seed + drawIndex (no deck IO in this phase)
  const h = sha256Hex(`${seed}::draw::${args.drawIndex}`);
  return `HEROREF_${args.side}_${h.slice(0, 10)}`;
}

export function runSessionV1(args: {
  session: SessionV1;
  appConfig: AppConfig;
  formatRegistry: FormatRegistry;
  gameModeRegistry: GameModeRegistry;
  matchIdForDeterminism: string; // required for deterministic replays
  ruleSetJson?: any | null;
}): RunResultV1 {
  // 1) matchSeed (sole entropy)
  const matchSeed = sha256Hex(`MATCHSEED::${args.matchIdForDeterminism}`);
  args.session.setMatchSeed(matchSeed);
  // Ensure timeline envelope carries matchId (Spec v0.3)
  args.session.setMatchIdForTimeline(args.matchIdForDeterminism);

  // 2) deterministic clock for timeline.at
  const at = (idx: number) => deterministicIsoFromSeed(matchSeed, idx);

  // 3) ruleset knobs (external to mode)
  const rules = args.session.getRulesetKnobs(args.ruleSetJson ?? null);

  // 4) lifecycle: LOAD_RULES → SETUP_MODE
  if (args.session.phase === "CREATED") {
    args.session.appendTimelineEventV3({
      eventType: "LOAD_RULES",
      at: at(0),
      actor: "SYSTEM",
      battleIndex: null,
      laneIndex: null,
      sdRound: null,
      payload: {
        rulesetSnapshotHash: args.session.rulesetSnapshotHash(matchSeed, rules),
        seed: matchSeed,
      },
    });

    args.session.appendTimelineEventV3({
      eventType: "SETUP_START",
      at: at(1),
      actor: "SYSTEM",
      battleIndex: null,
      laneIndex: null,
      sdRound: null,
      payload: { setupSnapshotHash: "PENDING" },
    });

    args.session.beginSetup({
      appConfig: args.appConfig,
      formatRegistry: args.formatRegistry,
      gameModeRegistry: args.gameModeRegistry,
    });

    const setupSnapshotHash = args.session.setupSnapshotHash(matchSeed);

    args.session.appendTimelineEventV3({
      eventType: "SETUP_COMPLETE",
      at: at(2),
      actor: "SYSTEM",
      battleIndex: null,
      laneIndex: null,
      sdRound: null,
      payload: { setupSnapshotHash },
    });

    const firstPlayer = coinFlipFirstPlayer(matchSeed);
    args.session.setFirstPlayer(firstPlayer);

    args.session.appendTimelineEventV3({
      eventType: "MATCH_START",
      at: at(3),
      actor: "SYSTEM",
      battleIndex: null,
      laneIndex: null,
      sdRound: null,
      payload: {},
    });
  }

  // 5) SETUP_MODE → RUN_REGULATION
  if (args.session.phase === "SETUP") {
    args.session.enterRegulation();
  }

  // 6) RUN_REGULATION (battle loop)
  let timelineIdx = 4;

  if (args.session.phase === "REGULATION") {
    const regulationBattles = rules.regulationBattles;
    const chipTarget = rules.chipTarget;

    // Pairing invariant mirror(i) = 8 - i for lanes 1..7 (Spec v0.3)
    const mirror = (i: number) => 8 - i;

    for (let battleIndex = 1; battleIndex <= regulationBattles; battleIndex++) {
      // Early stop if chipTarget reached
      const chips = args.session.getChipCounts();
      if (chips.LS >= chipTarget || chips.OP >= chipTarget) break;

      const laneIndex = battleIndex; // 1..7
      const paired = { LS: laneIndex, OP: mirror(laneIndex) };

      args.session.appendTimelineEventV3({
        eventType: "BATTLE_START",
        at: at(timelineIdx++),
        actor: "SYSTEM",
        battleIndex,
        laneIndex,
        sdRound: null,
        payload: { pairedLanes: paired },
      });

      // Minimal mode mechanics in this phase: deterministic outcome only
      const outcome = outcomeForBattle({ matchSeed, battleIndex });

      args.session.appendTimelineEventV3({
        eventType: "RESOLVE",
        at: at(timelineIdx++),
        actor: "SYSTEM",
        battleIndex,
        laneIndex,
        sdRound: null,
        payload: {
          outcome,
          LS_powerFinal: outcome === "LS" ? 1 : 0,
          OP_powerFinal: outcome === "OP" ? 1 : 0,
        },
      });

      if (outcome === "LS" || outcome === "OP") {
        const newChipCounts = args.session.awardChip(outcome);
        args.session.appendTimelineEventV3({
          eventType: "CHIP_AWARDED",
          at: at(timelineIdx++),
          actor: outcome,
          battleIndex,
          laneIndex,
          sdRound: null,
          payload: { winner: outcome, newChipCounts },
        });
      }

      args.session.incrementBattleCount();

      args.session.appendTimelineEventV3({
        eventType: "BATTLE_END",
        at: at(timelineIdx++),
        actor: "SYSTEM",
        battleIndex,
        laneIndex,
        sdRound: null,
        payload: { outcome },
      });
    }

    // Regulation end evaluation
    const endEval = args.session.evaluateRegulationEnd(rules);

    args.session.appendTimelineEventV3({
      eventType: "REGULATION_END",
      at: at(timelineIdx++),
      actor: "SYSTEM",
      battleIndex: null,
      laneIndex: null,
      sdRound: null,
      payload: {
        endReason: endEval.endReason,
        outcome: endEval.outcome,
      },
    });

    if (endEval.outcome === "LS" || endEval.outcome === "OP") {
      args.session.endMatchWithWinner(endEval.outcome, "REGULATION");
      args.session.appendTimelineEventV3({
        eventType: "MATCH_END",
        at: at(timelineIdx++),
        actor: "SYSTEM",
        battleIndex: null,
        laneIndex: null,
        sdRound: null,
        payload: { endMethod: "REGULATION", winner: endEval.outcome },
      });
    } else {
      // TIE after regulation
      if (rules.tiebreakPolicy === "ALLOW_TIE") {
        args.session.endMatchTie("ALLOW_TIE");
        args.session.appendTimelineEventV3({
          eventType: "MATCH_END",
          at: at(timelineIdx++),
          actor: "SYSTEM",
          battleIndex: null,
          laneIndex: null,
          sdRound: null,
          payload: { endMethod: "TIE", winner: NoneNull() },
        });
      } else {
        args.session.enterSuddenDeath(rules);
      }
    }
  }

  // 7) RUN_TIEBREAK (SUDDEN DEATH)
  if (args.session.phase === "SUDDEN_DEATH") {
    const sd = args.session.getSuddenDeathConfig();

    args.session.appendTimelineEventV3({
      eventType: "SUDDEN_DEATH_START",
      at: at(timelineIdx++),
      actor: "SYSTEM",
      battleIndex: null,
      laneIndex: null,
      sdRound: 1,
      payload: { sdConfigSnapshotHash: args.session.suddenDeathConfigHash(matchSeed, sd) },
    });

    let drawIndex = 0;
    let outcome: "LS" | "OP" | "TIE" = "TIE";

    for (let sdRound = 1; sdRound <= (sd.sdMaxRounds ?? 10_000); sdRound++) {
      args.session.appendTimelineEventV3({
        eventType: "SD_ROUND_START",
        at: at(timelineIdx++),
        actor: "SYSTEM",
        battleIndex: null,
        laneIndex: null,
        sdRound,
        payload: { sdRound },
      });

      // SD_DRAW / SD_REVEAL — stub heroRef materialization
      const LS_heroRef = heroRefFor({ matchSeed, side: "LS", drawIndex: drawIndex++ });
      const OP_heroRef = heroRefFor({ matchSeed, side: "OP", drawIndex: drawIndex++ });

      args.session.appendTimelineEventV3({
        eventType: "SD_DRAW",
        at: at(timelineIdx++),
        actor: "SYSTEM",
        battleIndex: null,
        laneIndex: null,
        sdRound,
        payload: { LS_heroRef, OP_heroRef },
      });

      args.session.appendTimelineEventV3({
        eventType: "SD_REVEAL",
        at: at(timelineIdx++),
        actor: "SYSTEM",
        battleIndex: null,
        laneIndex: null,
        sdRound,
        payload: { LS_heroRef, OP_heroRef },
      });

      outcome = outcomeForSuddenDeathRound({ matchSeed, sdRound });

      args.session.appendTimelineEventV3({
        eventType: "SD_RESOLVE",
        at: at(timelineIdx++),
        actor: "SYSTEM",
        battleIndex: null,
        laneIndex: null,
        sdRound,
        payload: { outcome },
      });

      args.session.incrementSuddenDeathRoundCount();

      if (outcome === "LS" || outcome === "OP") break;

      // If max rounds is set, loop bound handles it.
      // If can end in tie and we've reached max, we'll resolve below.
      if (sd.sdMaxRounds !== null && sdRound >= sd.sdMaxRounds) break;
    }

    // SD_END + MATCH_END
    const sdOutcome: "LS" | "OP" | "TIE" = outcome === "TIE" ? "TIE" : outcome;
    args.session.appendTimelineEventV3({
      eventType: "SD_END",
      at: at(timelineIdx++),
      actor: "SYSTEM",
      battleIndex: null,
      laneIndex: null,
      sdRound: null,
      payload: { suddenDeathRounds: args.session.getSuddenDeathRounds(), outcome: sdOutcome },
    });

    if (sdOutcome === "LS" || sdOutcome === "OP") {
      args.session.endMatchWithWinner(sdOutcome, "SUDDEN_DEATH");
      args.session.appendTimelineEventV3({
        eventType: "MATCH_END",
        at: at(timelineIdx++),
        actor: "SYSTEM",
        battleIndex: null,
        laneIndex: null,
        sdRound: null,
        payload: { endMethod: "SUDDEN_DEATH", winner: sdOutcome },
      });
    } else {
      // Tie in sudden death
      if (sd.sdCanEndInTie) {
        args.session.endMatchTie("SUDDEN_DEATH_TIE");
        args.session.appendTimelineEventV3({
          eventType: "MATCH_END",
          at: at(timelineIdx++),
          actor: "SYSTEM",
          battleIndex: null,
          laneIndex: null,
          sdRound: null,
          payload: { endMethod: "TIE", winner: NoneNull() },
        });
      } else {
        // If ties not allowed, force a deterministic winner using next bit of entropy stream.
        const forced = sha256Hex(`${matchSeed}::sd::force`).endsWith("0") ? "LS" : "OP";
        args.session.endMatchWithWinner(forced, "SUDDEN_DEATH");
        args.session.appendTimelineEventV3({
          eventType: "MATCH_END",
          at: at(timelineIdx++),
          actor: "SYSTEM",
          battleIndex: null,
          laneIndex: null,
          sdRound: null,
          payload: { endMethod: "SUDDEN_DEATH", winner: forced },
        });
      }
    }
  }

  if (args.session.phase !== "COMPLETE") {
    throw new Error(`SESSION_RUNNER_FAILED_TO_COMPLETE: ended at ${args.session.phase}`);
  }

  return { sessionId: args.session.sessionId, phase: "COMPLETE" };
}

// Helper for typed null in payloads without changing contract
function NoneNull(): null {
  return null;
}
