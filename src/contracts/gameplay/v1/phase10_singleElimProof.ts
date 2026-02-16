/**
 * phase10_singleElimProof.ts — Minimal proof: artifacts -> single-elim bracket snapshot + tournament.completed event.
 *
 * Phase 10 Proof (Structure #2):
 * - Uses InProcessMockEngineAdapterV1 to generate MatchArtifactV1 receipts for bracket slots
 * - Builds a TournamentV1 (SINGLE_ELIMINATION) with schedule spine
 * - Derives standings + bracket snapshot via SingleEliminationDeriverV1 (artifact-only)
 * - Produces tournament.completed event via TournamentEventProducerV1 (artifact-only)
 *
 * Usage:
 *   npx -y tsx src/contracts/gameplay/v1/phase10_singleElimProof.ts
 */

import { InProcessMockEngineAdapterV1 } from "./InProcessMockEngineAdapterV1";
import { SingleEliminationDeriverV1 } from "./SingleEliminationDeriverV1";
import { produceTournamentCompletedEventV1 } from "./TournamentEventProducerV1";
import type { JSONObject } from "./MatchArtifactV1";
import type { TournamentV1 } from "./TournamentV1";

function logJson(label: string, obj: unknown) {
  // eslint-disable-next-line no-console
  console.log(`\n== ${label} ==\n${JSON.stringify(obj, null, 2)}`);
}

async function makeArtifact(params: {
  adapter: InProcessMockEngineAdapterV1;
  matchId: string;
  seed: string;
  participants: Array<{ participantId: string; extra?: JSONObject }>;
  universeCode: string;
  engineCode: string;
  engineVersion: string;
  modeCode: string;
  inputs: JSONObject;
}) {
  const { adapter, matchId, seed, participants, universeCode, engineCode, engineVersion, modeCode, inputs } = params;

  const init = await adapter.createMatch({
    universeCode,
    engineCode,
    engineVersion,
    modeCode,
    matchId,
    participants,
    seed,
    inputs,
  });

  if (!init.ok || init.state === undefined) throw new Error("createMatch failed in proof harness");

  const run = await adapter.runMatch({
    universeCode,
    engineCode,
    engineVersion,
    modeCode,
    matchId,
    seed,
    state: init.state,
    inputs,
  });

  if (!run.ok || !run.outputs) throw new Error("runMatch failed in proof harness");

  return adapter.produceArtifact({
    universeCode,
    engineCode,
    engineVersion,
    modeCode,
    matchId,
    seed,
    participants,
    inputs,
    outputs: run.outputs,
  });
}

async function main() {
  const adapter = new InProcessMockEngineAdapterV1();
  const deriver = new SingleEliminationDeriverV1();

  // Locked binding for the tournament (must match artifacts)
  const universeCode = "UNIV_TEST";
  const engineCode = "MOCK_ENGINE";
  const engineVersion = "0.0.1";
  const modeCode = "ROOKIE";

  // 4-player bracket:
  // Round 1: (P1 vs P2) = QF1, (P3 vs P4) = QF2
  // Round 2: winners of QF1/QF2 = FINAL
  const players = [
    { participantId: "P1", extra: { name: "Player One" } as JSONObject },
    { participantId: "P2", extra: { name: "Player Two" } as JSONObject },
    { participantId: "P3", extra: { name: "Player Three" } as JSONObject },
    { participantId: "P4", extra: { name: "Player Four" } as JSONObject },
  ];

  const tournament: TournamentV1 = {
    header: {
      tournamentVersion: "TournamentV1",
      tournamentId: "T_SINGLEELIM_001",
      name: "Phase 10 Proof — Single Elimination",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "ACTIVE",
      universeCode,
      engineCode,
      engineVersion,
      modeCode,
      structure: "SINGLE_ELIMINATION",
      meta: { purpose: "phase10_single_elim_proof" } as JSONObject,
    },
    participants: players.map((p) => ({ participantId: p.participantId, label: p.participantId, extra: p.extra })),
    schedule: [
      { slotId: "QF1", round: 1, position: "A", participantIds: ["P1", "P2"], matchId: "M_QF1" },
      { slotId: "QF2", round: 1, position: "B", participantIds: ["P3", "P4"], matchId: "M_QF2" },
      { slotId: "FINAL", round: 2, position: "A", participantIds: ["TBD_QF1_WIN", "TBD_QF2_WIN"], matchId: "M_FINAL" },
    ],
    artifactIndex: [],
    extra: { note: "Single-elim proof. Bracket view derived from artifacts only." } as JSONObject,
  };

  const baseInputs = (pids: string[]): JSONObject => ({
    participants: pids.map((participantId) => ({ participantId })),
    proof: { kind: "phase10_single_elim" },
  });

  // Generate Round 1 artifacts
  const aQF1 = await makeArtifact({
    adapter,
    matchId: "M_QF1",
    seed: "seed-se-1",
    participants: players.filter((p) => ["P1", "P2"].includes(p.participantId)),
    universeCode,
    engineCode,
    engineVersion,
    modeCode,
    inputs: baseInputs(["P1", "P2"]),
  });

  const aQF2 = await makeArtifact({
    adapter,
    matchId: "M_QF2",
    seed: "seed-se-2",
    participants: players.filter((p) => ["P3", "P4"].includes(p.participantId)),
    universeCode,
    engineCode,
    engineVersion,
    modeCode,
    inputs: baseInputs(["P3", "P4"]),
  });

  // Determine finalists from Round 1 winners (from artifacts only)
  const w1 = aQF1.result.winnerParticipantId!;
  const w2 = aQF2.result.winnerParticipantId!;

  // Generate Final artifact
  const aFinal = await makeArtifact({
    adapter,
    matchId: "M_FINAL",
    seed: "seed-se-3",
    participants: players.filter((p) => [w1, w2].includes(p.participantId)),
    universeCode,
    engineCode,
    engineVersion,
    modeCode,
    inputs: baseInputs([w1, w2]),
  });

  const artifacts = [aQF1, aQF2, aFinal];

  logJson("Artifacts (result summaries)", artifacts.map((a) => ({
    matchId: a.header.matchId,
    winner: a.result.winnerParticipantId,
    hash: a.deterministicHash.value,
  })));

  const standings = deriver.deriveStandings({ tournament, artifacts });
  const progress = deriver.deriveProgress({ tournament, artifacts });

  logJson("Single-elim standings", standings);
  logJson("Single-elim bracket snapshot (progress.view)", progress.view);

  const completedEvent = produceTournamentCompletedEventV1({
    tournament,
    artifacts,
    deriver,
    correlation: { requestId: "REQ_SINGLEELIM_PROOF" },
  });

  logJson("tournament.completed event (or null)", completedEvent);

  // eslint-disable-next-line no-console
  console.log(
    `\nSUMMARY: artifacts=${artifacts.length} champion=${(progress.view as any)?.championParticipantId ?? "unknown"} event=${completedEvent ? "emitted" : "null"}`
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
