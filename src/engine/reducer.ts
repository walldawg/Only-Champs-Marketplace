// src/engine/reducer.ts

import type { GameAction, MatchState, Seat } from "./types";

function isSeatPair12(seats: Seat[]): boolean {
  if (seats.length !== 2) return false;
  const s = [...seats].sort((a, b) => a - b);
  return s[0] === 1 && s[1] === 2;
}

function getSeatsFromState(state: MatchState): Seat[] {
  // We keep seats in meta for deterministic validation.
  const seats = (state.meta?.seats as unknown) ?? [];
  return Array.isArray(seats) ? (seats as Seat[]) : [];
}

function ensureRookie(state: MatchState): Required<Pick<MatchState, "rookie">>["rookie"] {
  if (!state.rookie) {
    state.rookie = {
      phase: "SETUP",
      placements: {},
      lastPlaceAt: {},
      revealedZones: {},
    };
  }
  return state.rookie;
}

export function makeInitialState(args: { modeCode: string; seats: Seat[] }): MatchState {
  const { modeCode, seats } = args;
  const base: MatchState = {
    modeCode,
    status: "LOBBY",
    turn: 0,
    activeSeat: seats.length > 0 ? seats[0] : null,
    meta: { seats: [...seats].sort((a, b) => a - b) },
  };

  if (modeCode === "ROOKIE") {
    base.rookie = {
      phase: "SETUP",
      placements: {},
      lastPlaceAt: {},
      revealedZones: {},
    };
  }

  return base;
}

export function reduce(stateIn: MatchState, action: GameAction): MatchState {
  // Deterministic: never mutate input reference
  const state: MatchState = JSON.parse(JSON.stringify(stateIn));

  if (!action?.type || typeof action.type !== "string") return state;

  switch (action.type) {
    case "START": {
      if (state.status !== "LOBBY") return state;
      state.status = "ACTIVE";
      // Contract note: echo modeCode in state already present.
      if (state.modeCode === "ROOKIE") {
        const r = ensureRookie(state);
        r.phase = "SETUP"; // structure-only seed
      }
      return state;
    }

    case "END_TURN": {
      if (state.status !== "ACTIVE") return state;
      const seats = getSeatsFromState(state);
      if (seats.length === 0) return state;

      state.turn = (state.turn ?? 0) + 1;

      const idx = seats.indexOf(state.activeSeat ?? seats[0]);
      const next = idx < 0 ? seats[0] : seats[(idx + 1) % seats.length];
      state.activeSeat = next;

      return state;
    }

    // --- Rookie overlay actions (overlay-only) ---
    case "ROOKIE_PLACE": {
      if (state.modeCode !== "ROOKIE") return state;
      if (state.status !== "ACTIVE") return state;

      const r = ensureRookie(state);
      const payload = (action.payload ?? {}) as any;

      const seat: Seat = payload.seat;
      const zoneIndex = String(payload.zoneIndex);
      const placement = payload.placement;

      if (typeof seat !== "number" || !zoneIndex) return state;

      r.placements[String(seat)] = r.placements[String(seat)] ?? {};
      r.placements[String(seat)][zoneIndex] = placement;

      r.lastPlaceAt[String(seat)] = r.lastPlaceAt[String(seat)] ?? {};
      r.lastPlaceAt[String(seat)][zoneIndex] = payload.at ?? new Date(0).toISOString();

      // phase can move forward but stays deterministic and permissive
      if (r.phase === "SETUP") r.phase = "MATCH";
      return state;
    }

    case "ROOKIE_REVEAL": {
      if (state.modeCode !== "ROOKIE") return state;
      if (state.status !== "ACTIVE") return state;

      const r = ensureRookie(state);
      const payload = (action.payload ?? {}) as any;
      const zoneIndex = String(payload.zoneIndex);
      if (!zoneIndex) return state;

      r.revealedZones[zoneIndex] = true;
      return state;
    }

    case "ROOKIE_HIDE": {
      if (state.modeCode !== "ROOKIE") return state;
      if (state.status !== "ACTIVE") return state;

      const r = ensureRookie(state);
      const payload = (action.payload ?? {}) as any;
      const zoneIndex = String(payload.zoneIndex);
      if (!zoneIndex) return state;

      r.revealedZones[zoneIndex] = false;
      return state;
    }

    case "ROOKIE_RESOLVE_MATCH":
    case "ROOKIE_SCORE_MATCH": {
      if (state.modeCode !== "ROOKIE") return state;
      if (state.status !== "ACTIVE") return state;

      // Validation per contract happens at route layer (400 rookie_score_invalid).
      // Reducer writes results deterministically from payload.
      const r = ensureRookie(state);
      r.results = action.payload ?? null;
      r.phase = "ENDED";
      return state;
    }

    case "ROOKIE_OVERTIME_DRAW": {
      if (state.modeCode !== "ROOKIE") return state;
      if (state.status !== "ACTIVE") return state;

      const r = ensureRookie(state);
      r.overtime = { ...(r.overtime ?? {}), draw: action.payload ?? true };
      return state;
    }

    case "ROOKIE_OVERTIME_REVEAL": {
      if (state.modeCode !== "ROOKIE") return state;
      if (state.status !== "ACTIVE") return state;

      const r = ensureRookie(state);
      r.overtime = { ...(r.overtime ?? {}), reveal: action.payload ?? true };
      return state;
    }

    case "ROOKIE_RESET_OVERTIME": {
      if (state.modeCode !== "ROOKIE") return state;
      if (state.status !== "ACTIVE") return state;

      const r = ensureRookie(state);
      r.overtime = undefined;
      return state;
    }

    default:
      return state;
  }
}

export function validateRookieScoreAttempt(state: MatchState): null | {
  error: "rookie_score_invalid";
  phaseInvalid?: { required: string[]; actual: string };
  seatInvalid?: { required: number[]; actual: number[] };
} {
  if (state.modeCode !== "ROOKIE") return { error: "rookie_score_invalid" };

  const r = state.rookie;
  if (!r) return { error: "rookie_score_invalid" };

  const requiredPhases = ["MATCH", "ENDED"];
  if (!requiredPhases.includes(r.phase)) {
    return {
      error: "rookie_score_invalid",
      phaseInvalid: { required: requiredPhases, actual: r.phase },
    };
  }

  const seats = getSeatsFromState(state);
  if (!isSeatPair12(seats)) {
    return {
      error: "rookie_score_invalid",
      seatInvalid: { required: [1, 2], actual: seats },
    };
  }

  return null;
}
