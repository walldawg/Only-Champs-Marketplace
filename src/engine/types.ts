// src/engine/types.ts

export type ModeCode = "ROOKIE" | string;

export type GameStatus = "LOBBY" | "ACTIVE" | "CLOSED";

export type Seat = number;

export type GameActionType =
  | "START"
  | "END_TURN"
  | "ROOKIE_PLACE"
  | "ROOKIE_REVEAL"
  | "ROOKIE_HIDE"
  | "ROOKIE_SCORE_MATCH"
  | "ROOKIE_RESOLVE_MATCH"
  | "ROOKIE_OVERTIME_DRAW"
  | "ROOKIE_OVERTIME_REVEAL"
  | "ROOKIE_RESET_OVERTIME";

export type GameAction = {
  type: GameActionType | string;
  payload?: unknown;
};

export type GameEvent = {
  gameId: string;
  seq: number;
  at: string; // ISO string
  type: string;
  payload?: unknown;
};

export type GamePlayer = {
  seat: Seat;
  deckId: string;
};

export type RookiePlacements = Record<string, Record<string, unknown>>;

export type RookieState = {
  phase: "SETUP" | "MATCH" | "ENDED" | string;
  placements: Record<string, Record<string, unknown>>; // [seat][zoneIndex] = placement
  lastPlaceAt: Record<string, Record<string, string>>; // [seat][zoneIndex] = iso time
  revealedZones: Record<string, boolean>; // [zoneIndex] = true/false
  results?: unknown;
  overtime?: unknown;
};

export type MatchState = {
  modeCode: ModeCode;
  status: GameStatus;

  // baseline minimal reducer contract:
  turn: number;
  activeSeat: Seat | null;

  // mode overlay:
  rookie?: RookieState;

  // extra state allowed, but must remain deterministic:
  meta?: Record<string, unknown>;
};

export type Game = {
  id: string;
  modeCode: ModeCode;
  status: GameStatus;
  players: GamePlayer[];
  events: GameEvent[];
  state: MatchState;
};
