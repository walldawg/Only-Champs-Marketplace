// src/engine/session.v1.ts
// Setup boundary snapshot + immutability + deterministic session state.
// Milestone B (B1): Contract-compliant timeline emission (deterministic timestamps).
//
// Patch v0.3 stabilization (single-file consolidation):
// - Removes duplicate/partial definitions introduced by iterative patches.
// - Preserves optional ruleset pointer + ruleSetJson.
// - Provides runner-expected SessionV1 methods (chip + sudden death helpers).
// - No gameplay authority changes. Deterministic only.

import type { AppConfig, FormatRegistry, GameModeRegistry } from "../config/registryLoaders.v1";
import { validateSessionCanEnterSetup, type SessionPointer } from "../config/sessionGate.v1";
import type { MatchTimelineEventV1, JSONObject } from "../contracts/gameplay/v1/MatchArtifactV1";

export type SessionPhase = "CREATED" | "SETUP" | "REGULATION" | "SUDDEN_DEATH" | "BATTLE_LOOP" | "COMPLETE";

export type SessionSnapshots = {
  formatSnapshot: ReturnType<typeof validateSessionCanEnterSetup>["formatSnapshot"];
  gameModeSnapshot: ReturnType<typeof validateSessionCanEnterSetup>["gameModeSnapshot"];
};

export type BattleOutcomeV1 = {
  winner: "HOME" | "AWAY" | "DRAW";
  totalBattles: number;
  winReason: string;
  finalCoinCount?: { home: number; away: number };
};

export type SessionPointerV1 = SessionPointer & {
  ruleset?: { ruleSetKey: string; ruleSetVersion: number } | null;
};

type ChipSide = "LS" | "OP";
type ChipCounts = { LS: number; OP: number };

export class SessionV1 {
  readonly sessionId: string;

  private _phase: SessionPhase = "CREATED";
  private _locked = false;

  private _pointer: SessionPointerV1;
  private _snapshots: SessionSnapshots | null = null;

  private _ruleSetJson: any | null = null;
  private _firstPlayer: string | null = null;

  // Deterministic inputs (set by runner before/at setup)
  private _matchId: string | null = null;
  private _matchSeed: string | null = null;

  // Milestone B1: timeline accumulated by runner in deterministic order.
  private _timeline: MatchTimelineEventV1[] = [];

  // Outcome
  private _battleOutcome: BattleOutcomeV1 | null = null;

  // Lightweight deterministic counters (used by lifecycle runner)
  private _chipCounts: ChipCounts = { LS: 0, OP: 0 };
  private _battleCount = 0; // regulation+sd battles
  private _suddenDeathRoundCount = 0;

  constructor(args: { sessionId: string; pointer: SessionPointerV1 & { ruleset?: { ruleSetKey: string; ruleSetVersion: number } | null }; ruleSetJson?: any | null }) {
    this.sessionId = args.sessionId;

    this._pointer = {
      format: { ...args.pointer.format },
      gameMode: { ...args.pointer.gameMode },
      ruleset: args.pointer.ruleset ?? null,
    };

    this._ruleSetJson = args.ruleSetJson ?? null;
  }

  // -----------------------------
  // Getters
  // -----------------------------
  get phase(): SessionPhase {
    return this._phase;
  }

  get pointer(): Readonly<SessionPointerV1> {
    return this._pointer;
  }

  get snapshots(): Readonly<SessionSnapshots> | null {
    return this._snapshots;
  }

  get ruleSetJson(): any | null {
    return this._ruleSetJson;
  }

  get firstPlayer(): string | null {
    return this._firstPlayer;
  }

  get matchId(): string | null {
    return this._matchId;
  }

  get matchSeed(): string | null {
    return this._matchSeed;
  }

  get battleOutcome(): Readonly<BattleOutcomeV1> | null {
    return this._battleOutcome;
  }

  get timeline(): ReadonlyArray<MatchTimelineEventV1> {
    return this._timeline;
  }

  /** Convenience for downstream consumers. */
  get rulesetId(): string {
    const r = this._pointer.ruleset;
    if (!r || !r.ruleSetKey) return "UNBOUND";
    return `${r.ruleSetKey}@${Number(r.ruleSetVersion)}`;
  }

  // -----------------------------
  // Runner-facing determinism helpers
  // -----------------------------
  setMatchId(matchId: string) {
    this.ensureMutable("setMatchId");
    const v = String(matchId ?? "").trim();
    this._matchId = v ? v : null;
  }

  setMatchSeed(seed: string) {
    this.ensureMutable("setMatchSeed");
    const v = String(seed ?? "").trim();
    this._matchSeed = v ? v : null;
  }

  // Aliases used by runner variants
  setMatchIdForTimeline(matchId: string) {
    this.setMatchId(matchId);
  }

  setSeedForTimeline(seed: string) {
    this.setMatchSeed(seed);
  }

  getMatchId(): string | null {
    return this._matchId;
  }

  getMatchSeed(): string | null {
    return this._matchSeed;
  }

  getMatchIdForTimeline(): string | null {
    return this.getMatchId();
  }

  getSeedForTimeline(): string | null {
    return this.getMatchSeed();
  }

  setRuleSetJson(ruleSetJson: any | null) {
    this.ensureMutable("setRuleSetJson");
    this._ruleSetJson = ruleSetJson ?? null;
  }

  getRuleSetJson(): any | null {
    return this._ruleSetJson;
  }

  setFirstPlayer(firstPlayer: string) {
    // firstPlayer is chosen during setup/run; allow during SETUP+REGULATION too
    const v = String(firstPlayer ?? "").trim();
    this._firstPlayer = v ? v : null;
  }

  getFirstPlayer(): string | null {
    return this._firstPlayer;
  }

  getRulesetId(): string {
    return this.rulesetId;
  }

  // -----------------------------
  // Ruleset knobs (deterministic)
  // -----------------------------
  getRulesetKnobs(): any {
    const raw = ensureObj(this._ruleSetJson);
    const k = ensureObj((raw as any).engineKnobs ?? (raw as any).knobs ?? raw);

    // Defaults tuned to current runner assumptions
    const regulationBattles =
      typeof (k as any).regulationBattles === "number" && Number.isFinite((k as any).regulationBattles)
        ? Math.max(1, Math.floor((k as any).regulationBattles))
        : 7;

    const chipTarget =
      typeof (k as any).chipTarget === "number" && Number.isFinite((k as any).chipTarget)
        ? Math.max(1, Math.floor((k as any).chipTarget))
        : 4;

    const regulationEndPolicy =
      typeof (k as any).regulationEndPolicy === "string" && (k as any).regulationEndPolicy.trim()
        ? String((k as any).regulationEndPolicy).trim()
        : "EITHER";

    const sdDrawSource =
      (k as any).sdDrawSource === "ALL_HERO_CARDS" ? "ALL_HERO_CARDS" : "HERO_DECK_ONLY";

    const sdReshufflePolicy =
      (k as any).sdReshufflePolicy === "RESHUFFLE_ALL_HERO_CARDS"
        ? "RESHUFFLE_ALL_HERO_CARDS"
        : "RESHUFFLE_DISCARD_INTO_DECK";

    const sdCanEndInTie = typeof (k as any).sdCanEndInTie === "boolean" ? (k as any).sdCanEndInTie : true;

    const sdMaxRounds =
      typeof (k as any).sdMaxRounds === "number" && Number.isFinite((k as any).sdMaxRounds)
        ? Math.max(1, Math.floor((k as any).sdMaxRounds))
        : null;

    const sdTieAfterCapPolicy =
      typeof (k as any).sdTieAfterCapPolicy === "string" && String((k as any).sdTieAfterCapPolicy).trim()
        ? String((k as any).sdTieAfterCapPolicy).trim()
        : null;

    return deepFreeze({
      regulationBattles,
      chipTarget,
      regulationEndPolicy,
      sdDrawSource,
      sdReshufflePolicy,
      sdCanEndInTie,
      sdMaxRounds,
      sdTieAfterCapPolicy,
    });
  }

  getSuddenDeathConfig(): {
    sdDrawSource: "HERO_DECK_ONLY" | "ALL_HERO_CARDS";
    sdReshufflePolicy: "RESHUFFLE_DISCARD_INTO_DECK" | "RESHUFFLE_ALL_HERO_CARDS";
    sdCanEndInTie: boolean;
    sdMaxRounds: number | null;
    sdTieAfterCapPolicy?: string | null;
  } {
    const k: any = this.getRulesetKnobs();
    return {
      sdDrawSource: k.sdDrawSource === "ALL_HERO_CARDS" ? "ALL_HERO_CARDS" : "HERO_DECK_ONLY",
      sdReshufflePolicy: k.sdReshufflePolicy === "RESHUFFLE_ALL_HERO_CARDS" ? "RESHUFFLE_ALL_HERO_CARDS" : "RESHUFFLE_DISCARD_INTO_DECK",
      sdCanEndInTie: !!k.sdCanEndInTie,
      sdMaxRounds: typeof k.sdMaxRounds === "number" ? k.sdMaxRounds : null,
      sdTieAfterCapPolicy: typeof k.sdTieAfterCapPolicy === "string" ? k.sdTieAfterCapPolicy : null,
    };
  }

  suddenDeathConfigHash(): string {
    return sha256Hex(stableStringify(this.getSuddenDeathConfig()));
  }

  rulesetSnapshotHash(): string {
    const snap = this._pointer.ruleset ?? null;
    const payload = {
      ruleset: snap ? { ruleSetKey: snap.ruleSetKey, ruleSetVersion: snap.ruleSetVersion } : null,
      rules: this._ruleSetJson ?? null,
    };
    return sha256Hex(stableStringify(payload));
  }

  setupSnapshotHash(): string {
    const payload = {
      pointer: this._pointer,
      snapshots: this._snapshots,
      rulesetSnapshotHash: this.rulesetSnapshotHash(),
    };
    return sha256Hex(stableStringify(payload));
  }

  // -----------------------------
  // Regulation helpers
  // -----------------------------
  evaluateRegulationEnd(args: {
    battleIndex: number;
    chipCounts: { LS: number; OP: number };
  }): { ended: boolean; endReason: string | null; outcome: ChipSide | "TIE" | null } {
    const battleIndex = Number(args?.battleIndex ?? 0);
    const chips = args?.chipCounts ?? ({ LS: 0, OP: 0 } as any);
    const chipLS = Number((chips as any).LS ?? 0);
    const chipOP = Number((chips as any).OP ?? 0);

    const knobs: any = this.getRulesetKnobs() ?? {};
    const regulationBattles = Number(knobs.regulationBattles ?? 7);
    const chipTarget = Number(knobs.chipTarget ?? 4);
    const endPolicy = String(knobs.regulationEndPolicy ?? "EITHER").toUpperCase();

    const reachedTarget = chipTarget > 0 && (chipLS >= chipTarget || chipOP >= chipTarget);
    if (reachedTarget && (endPolicy === "EITHER" || endPolicy === "CHIP_ONLY")) {
      const outcome = chipLS === chipOP ? "TIE" : chipLS > chipOP ? "LS" : "OP";
      return { ended: true, endReason: "CHIP_TARGET", outcome };
    }

    if (battleIndex >= regulationBattles && (endPolicy === "EITHER" || endPolicy === "BATTLES_ONLY")) {
      if (chipLS > chipOP) return { ended: true, endReason: "REGULATION_BATTLES", outcome: "LS" };
      if (chipOP > chipLS) return { ended: true, endReason: "REGULATION_BATTLES", outcome: "OP" };
      return { ended: true, endReason: "REGULATION_TIE", outcome: "TIE" };
    }

    return { ended: false, endReason: null, outcome: null };
  }

  // -----------------------------
  // Chip + Sudden Death helpers (missing API)
  // -----------------------------
  getChipCounts(): ChipCounts {
    return { ...this._chipCounts };
  }

  awardChip(winner: ChipSide) {
    const w = winner === "OP" ? "OP" : "LS";
    this._chipCounts = {
      LS: this._chipCounts.LS + (w === "LS" ? 1 : 0),
      OP: this._chipCounts.OP + (w === "OP" ? 1 : 0),
    };
  }

  incrementBattleCount() {
    this._battleCount += 1;
  }

  getSuddenDeathRounds(): number {
    return this._suddenDeathRoundCount;
  }

  incrementSuddenDeathRoundCount() {
    this._suddenDeathRoundCount += 1;
  }

  private toOutcomeWinner(side: ChipSide): "HOME" | "AWAY" {
    // Current runner vocabulary: LS = HOME, OP = AWAY
    return side === "OP" ? "AWAY" : "HOME";
  }

  endMatchWithWinner(winner: ChipSide, winReason: string = "REGULATION") {
    const out: BattleOutcomeV1 = {
      winner: this.toOutcomeWinner(winner),
      winReason,
      totalBattles: Math.max(0, this._battleCount),
      finalCoinCount: { home: this._chipCounts.LS, away: this._chipCounts.OP },
    };
    this.setBattleOutcome(out);
    this.complete();
  }

  endMatchTie(winReason: string = "SUDDEN_DEATH") {
    const out: BattleOutcomeV1 = {
      winner: "DRAW",
      winReason,
      totalBattles: Math.max(0, this._battleCount),
      finalCoinCount: { home: this._chipCounts.LS, away: this._chipCounts.OP },
    };
    this.setBattleOutcome(out);
    this.complete();
  }

  // Back-compat alias some runners use
  endMatchWithTie(winReason: string = "SUDDEN_DEATH") {
    this.endMatchTie(winReason);
  }

  // -----------------------------
  // Pointer mutation (pre-setup)
  // -----------------------------
  setFormatPointer(next: SessionPointer["format"]) {
    this.ensureMutable("setFormatPointer");
    this._pointer.format = { ...next };
  }

  setGameModePointer(next: SessionPointer["gameMode"]) {
    this.ensureMutable("setGameModePointer");
    this._pointer.gameMode = { ...next };
  }

  // -----------------------------
  // Lifecycle
  // -----------------------------
  beginSetup(args: { appConfig: AppConfig; formatRegistry: FormatRegistry; gameModeRegistry: GameModeRegistry }) {
    if (this._phase !== "CREATED") throw new Error(`SESSION_BAD_PHASE: beginSetup from ${this._phase}`);

    const out = validateSessionCanEnterSetup({
      appConfig: args.appConfig,
      formatRegistry: args.formatRegistry,
      gameModeRegistry: args.gameModeRegistry,
      session: this._pointer as any,
    });

    const snapshots: SessionSnapshots = {
      formatSnapshot: out.formatSnapshot,
      gameModeSnapshot: out.gameModeSnapshot,
    };

    deepFreeze(snapshots);
    this._snapshots = snapshots;
    this._locked = true;
    this._phase = "SETUP";
  }

  appendTimelineEvent(args: {
    code: string;
    at: string;
    participantId?: string;
    metrics?: Record<string, number>;
    extra?: JSONObject;
  }) {
    const e: MatchTimelineEventV1 = {
      idx: this._timeline.length,
      code: args.code,
      at: args.at,
      participantId: args.participantId,
      metrics: args.metrics,
      extra: args.extra,
    };
    deepFreeze(e);
    this._timeline.push(e);
  }

  appendTimelineEventV3(args: {
    code: string;
    at: string;
    participantId?: string;
    metrics?: Record<string, number>;
    extra?: JSONObject;
  }) {
    this.appendTimelineEvent(args);
  }

  enterRegulation() {
    if (this._phase !== "SETUP") throw new Error(`SESSION_BAD_PHASE: enterRegulation from ${this._phase}`);
    this._phase = "REGULATION";
  }

  enterSuddenDeath() {
    if (this._phase !== "REGULATION") throw new Error(`SESSION_BAD_PHASE: enterSuddenDeath from ${this._phase}`);
    this._phase = "SUDDEN_DEATH";
  }

  // Older runner compatibility (minimal engines may call this)
  enterBattleLoop() {
    if (this._phase === "SETUP") return this.enterRegulation();
    if (this._phase !== "SETUP") throw new Error(`SESSION_BAD_PHASE: enterBattleLoop from ${this._phase}`);
  }

  setBattleOutcome(outcome: BattleOutcomeV1) {
    if (this._phase === "COMPLETE") throw new Error(`SESSION_BAD_PHASE: setBattleOutcome from ${this._phase}`);
    if (this._battleOutcome) throw new Error("SESSION_BATTLE_OUTCOME_ALREADY_SET");
    deepFreeze(outcome);
    this._battleOutcome = outcome;
  }

  complete() {
    if (!this._battleOutcome) throw new Error("SESSION_COMPLETE_REQUIRES_BATTLE_OUTCOME");
    this._phase = "COMPLETE";
  }

  private ensureMutable(op: string) {
    if (this._locked) throw new Error(`SESSION_MUTATION_FORBIDDEN_POST_SETUP: ${op}`);
    if (this._phase !== "CREATED") throw new Error(`SESSION_BAD_PHASE: ${op} from ${this._phase}`);
  }
}

// -----------------------------
// Helpers (deterministic)
// -----------------------------
function stableStringify(value: any): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((v) => stableStringify(v)).join(",") + "]";
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ":" + stableStringify((value as any)[k]));
  return "{" + parts.join(",") + "}";
}

function sha256Hex(input: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require("node:crypto");
  return crypto.createHash("sha256").update(input).digest("hex");
}

function ensureObj(v: any): Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as any) : {};
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
