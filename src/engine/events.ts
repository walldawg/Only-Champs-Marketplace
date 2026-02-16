// src/engine/events.ts

import type { GameEvent, GameAction } from "./types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeEvent(args: {
  gameId: string;
  seq: number;
  action: GameAction;
  at?: string;
}): GameEvent {
  const { gameId, seq, action } = args;
  return {
    gameId,
    seq,
    at: args.at ?? nowIso(),
    type: action.type,
    payload: action.payload,
  };
}
