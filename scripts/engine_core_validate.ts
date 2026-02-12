// scripts/engine_core_validate.ts
import { newEngine } from "../src/engine/MatchState";
import { makeEvent } from "../src/engine/events";

const gameId = "G_TEST";
const engine = newEngine({ modeCode: "ROOKIE", seats: [1, 2] });

const events = [
  makeEvent({ gameId, seq: 1, action: { type: "START", payload: { at: "1970-01-01T00:00:00.000Z" } }, at: "1970-01-01T00:00:00.000Z" }),
  makeEvent({ gameId, seq: 2, action: { type: "END_TURN" }, at: "1970-01-01T00:00:00.000Z" }),
  makeEvent({ gameId, seq: 3, action: { type: "END_TURN" }, at: "1970-01-01T00:00:00.000Z" }),
  makeEvent({ gameId, seq: 4, action: { type: "ROOKIE_PLACE", payload: { seat: 1, zoneIndex: 0, placement: { versionKey: "HERO_X" }, at: "1970-01-01T00:00:00.000Z" } }, at: "1970-01-01T00:00:00.000Z" }),
  makeEvent({ gameId, seq: 5, action: { type: "ROOKIE_REVEAL", payload: { zoneIndex: 0 } }, at: "1970-01-01T00:00:00.000Z" }),
];

const state = engine.replay(events);

const ok =
  state.status === "ACTIVE" &&
  state.turn === 2 &&
  state.activeSeat === 1 &&
  state.rookie?.revealedZones?.["0"] === true &&
  (state.rookie?.placements?.["1"]?.["0"] as any)?.versionKey === "HERO_X";

if (!ok) {
  console.error("FAIL", state);
  process.exit(1);
}

console.log("PASS", {
  status: state.status,
  turn: state.turn,
  activeSeat: state.activeSeat,
  rookiePhase: state.rookie?.phase,
});
