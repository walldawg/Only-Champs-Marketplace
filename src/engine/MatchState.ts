// src/engine/MatchState.ts

import type { GameEvent, GameAction, MatchState } from "./types";
import { reduce, makeInitialState } from "./reducer";

export class MatchStateEngine {
  private readonly initial: MatchState;

  constructor(initial: MatchState) {
    this.initial = JSON.parse(JSON.stringify(initial));
  }

  public replay(events: GameEvent[]): MatchState {
    let s: MatchState = JSON.parse(JSON.stringify(this.initial));
    const ordered = [...events].sort((a, b) => a.seq - b.seq);

    for (const e of ordered) {
      const action: GameAction = { type: e.type, payload: e.payload };
      s = reduce(s, action);
    }

    return s;
  }
}

export function newEngine(args: { modeCode: string; seats: number[] }): MatchStateEngine {
  const initial = makeInitialState({ modeCode: args.modeCode, seats: args.seats });
  return new MatchStateEngine(initial);
}
