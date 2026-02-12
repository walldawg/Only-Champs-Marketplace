// src/engine/status.ts

import type { MatchState } from "./types";

export function assertLobby(state: MatchState): { ok: true } | { ok: false; error: string } {
  if (state.status !== "LOBBY") return { ok: false, error: "game is not in LOBBY" };
  return { ok: true };
}

export function assertActive(state: MatchState): { ok: true } | { ok: false; error: string } {
  if (state.status !== "ACTIVE") return { ok: false, error: "game is not ACTIVE" };
  return { ok: true };
}
