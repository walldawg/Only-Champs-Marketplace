// src/engine/session.v1.ts
// Setup boundary snapshot + immutability + deterministic battle outcome storage.

import type { AppConfig, FormatRegistry, GameModeRegistry } from "../config/registryLoaders.v1";
import { validateSessionCanEnterSetup, type SessionPointer } from "../config/sessionGate.v1";

export type SessionPhase = "CREATED" | "SETUP" | "BATTLE_LOOP" | "COMPLETE";

export type SessionSnapshots = {
  formatSnapshot: ReturnType<typeof validateSessionCanEnterSetup>["formatSnapshot"];
  gameModeSnapshot: ReturnType<typeof validateSessionCanEnterSetup>["gameModeSnapshot"];
};

export type BattleOutcomeV1 = {
  winner: "HOME" | "AWAY" | "DRAW";
  totalBattles: number;
  winReason: "DETERMINISTIC_HASH_V1";
};

export class SessionV1 {
  readonly sessionId: string;

  private _phase: SessionPhase = "CREATED";
  private _locked = false;

  private _pointer: SessionPointer;
  private _snapshots: SessionSnapshots | null = null;

  private _battleOutcome: BattleOutcomeV1 | null = null;

  constructor(args: { sessionId: string; pointer: SessionPointer }) {
    this.sessionId = args.sessionId;
    this._pointer = {
      format: { ...args.pointer.format },
      gameMode: { ...args.pointer.gameMode },
    };
  }

  get phase(): SessionPhase {
    return this._phase;
  }

  get pointer(): Readonly<SessionPointer> {
    return this._pointer;
  }

  get snapshots(): Readonly<SessionSnapshots> | null {
    return this._snapshots;
  }

  get battleOutcome(): Readonly<BattleOutcomeV1> | null {
    return this._battleOutcome;
  }

  setFormatPointer(next: SessionPointer["format"]) {
    this.ensureMutable("setFormatPointer");
    this._pointer.format = { ...next };
  }

  setGameModePointer(next: SessionPointer["gameMode"]) {
    this.ensureMutable("setGameModePointer");
    this._pointer.gameMode = { ...next };
  }

  beginSetup(args: {
    appConfig: AppConfig;
    formatRegistry: FormatRegistry;
    gameModeRegistry: GameModeRegistry;
  }) {
    if (this._phase !== "CREATED") throw new Error(`SESSION_BAD_PHASE: beginSetup from ${this._phase}`);

    const out = validateSessionCanEnterSetup({
      appConfig: args.appConfig,
      formatRegistry: args.formatRegistry,
      gameModeRegistry: args.gameModeRegistry,
      session: this._pointer,
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

  enterBattleLoop() {
    if (this._phase !== "SETUP") throw new Error(`SESSION_BAD_PHASE: enterBattleLoop from ${this._phase}`);
    this._phase = "BATTLE_LOOP";
  }

  setBattleOutcome(outcome: BattleOutcomeV1) {
    if (this._phase !== "BATTLE_LOOP") throw new Error(`SESSION_BAD_PHASE: setBattleOutcome from ${this._phase}`);
    if (this._battleOutcome) throw new Error("SESSION_BATTLE_OUTCOME_ALREADY_SET");
    deepFreeze(outcome);
    this._battleOutcome = outcome;
  }

  complete() {
    if (this._phase !== "BATTLE_LOOP") throw new Error(`SESSION_BAD_PHASE: complete from ${this._phase}`);
    if (!this._battleOutcome) throw new Error("SESSION_COMPLETE_REQUIRES_BATTLE_OUTCOME");
    this._phase = "COMPLETE";
  }

  private ensureMutable(op: string) {
    if (this._locked) throw new Error(`SESSION_MUTATION_FORBIDDEN_POST_SETUP: ${op}`);
    if (this._phase !== "CREATED") throw new Error(`SESSION_BAD_PHASE: ${op} from ${this._phase}`);
  }
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
