/**
 * phase10_tournamentProof.ts — Minimal proof: artifacts -> round-robin standings.
 *
 * Phase 10 Step 3:
 * - Uses InProcessMockEngineAdapterV1 to generate MatchArtifactV1 receipts
 * - Builds a TournamentV1 (ROUND_ROBIN)
 * - Derives standings via RoundRobinDeriverV1 (artifact-only)
 *
 * Usage:
 *   npx -y tsx src/contracts/gameplay/v1/phase10_tournamentProof.ts
 */

import { InProcessMockEngineAdapterV1 } from "./InProcessMockEngineAdapterV1";
import { RoundRobinDeriverV1 } from "./RoundRobinDeriverV1";
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
  const deriver = new RoundRobinDeriverV1();

  // Locked binding for the tournament (must match artifacts)
  const universeCode = "UNIV_TEST";
  const engineCode = "MOCK_ENGINE";
  const engineVersion = "0.0.1";
  const modeCode = "ROOKIE";

  // Tournament participants
  const players = [
    { participantId: "P1", extra: { name: "Player One" } as JSONObject },
    { participantId: "P2", extra: { name: "Player Two" } as JSONObject },
    { participantId: "P3", extra: { name: "Player Three" } as JSONObject },
  ];

  const tournament: TournamentV1 = {
    header: {
      tournamentVersion: "TournamentV1",
      tournamentId: "T_ROUNDROBIN_001",
      name: "Phase 10 Proof — Round Robin",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "ACTIVE",
      universeCode,
      engineCode,
      engineVersion,
      modeCode,
      structure: "ROUND_ROBIN",
      meta: { purpose: "phase10_proof" } as JSONObject,
    },
    participants: players.map((p) => ({ participantId: p.participantId, label: p.participantId, extra: p.extra })),
    schedule: [
      { slotId: "S1", round: 1, participantIds: ["P1", "P2"], matchId: "M1" },
      { slotId: "S2", round: 1, participantIds: ["P2", "P3"], matchId: "M2" },
      { slotId: "S3", round: 1, participantIds: ["P1", "P3"], matchId: "M3" },
    ],
    artifactIndex: [],
    extra: { note: "Artifacts drive standings. No engine calls during derivation." } as JSONObject,
  };

  // Build inputs packets (keep JSON simple)
  const baseInputs = (pids: string[]): JSONObject => ({
    participants: pids.map((participantId) => ({ participantId })),
    proof: { kind: "phase10_round_robin" },
  });

  // Generate three match artifacts with different seeds
  const a1 = await makeArtifact({
    adapter,
    matchId: "M1",
    seed: "seed-rr-1",
    participants: players.filter((p) => ["P1", "P2"].includes(p.participantId)),
    universeCode,
    engineCode,
    engineVersion,
    modeCode,
    inputs: baseInputs(["P1", "P2"]),
  });

  const a2 = await makeArtifact({
    adapter,
    matchId: "M2",
    seed: "seed-rr-2",
    participants: players.filter((p) => ["P2", "P3"].includes(p.participantId)),
    universeCode,
    engineCode,
    engineVersion,
    modeCode,
    inputs: baseInputs(["P2", "P3"]),
  });

  const a3 = await makeArtifact({
    adapter,
    matchId: "M3",
    seed: "seed-rr-3",
    participants: players.filter((p) => ["P1", "P3"].includes(p.participantId)),
    universeCode,
    engineCode,
    engineVersion,
    modeCode,
    inputs: baseInputs(["P1", "P3"]),
  });

  const artifacts = [a1, a2, a3];

  // Show minimal artifact results
  logJson("Artifacts (result summaries)", artifacts.map((a) => ({
    matchId: a.header.matchId,
    winner: a.result.winnerParticipantId,
    hash: a.deterministicHash.value,
  })));

  // Derive standings (artifact-only)
  const standings = deriver.deriveStandings({ tournament, artifacts });
  const progress = deriver.deriveProgress({ tournament, artifacts });

  logJson("Tournament standings", standings);
  logJson("Tournament progress", progress);

  // eslint-disable-next-line no-console
  console.log(
    `\nSUMMARY: standingsRows=${standings.rows.length} artifactsUsed=${standings.sourceArtifacts.length} matchesCompleted=${progress.matchesCompleted}`
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
