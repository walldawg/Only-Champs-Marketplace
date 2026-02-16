/**
 * phase12_rewardsProof.ts — Minimal proof: match artifact + tournament.completed -> reward intents.
 *
 * Phase 12 Proof:
 * - Generates a single match artifact (mock engine)
 * - Generates a single-elim tournament.completed event (via existing producer)
 * - Produces RewardEventV1[] from both sources
 *
 * Usage:
 *   npx -y tsx src/contracts/gameplay/v1/phase12_rewardsProof.ts
 */

import { InProcessMockEngineAdapterV1 } from "./InProcessMockEngineAdapterV1";
import { SingleEliminationDeriverV1 } from "./SingleEliminationDeriverV1";
import { produceTournamentCompletedEventV1 } from "./TournamentEventProducerV1";
import { produceRewardEventsFromMatchArtifactV1, produceRewardEventsFromTournamentCompletedV1 } from "./RewardEventProducerV1";
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

  if (!init.ok || init.state === undefined) throw new Error("createMatch failed in rewards proof");

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

  if (!run.ok || !run.outputs) throw new Error("runMatch failed in rewards proof");

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

  const universeCode = "UNIV_TEST";
  const engineCode = "MOCK_ENGINE";
  const engineVersion = "0.0.1";
  const modeCode = "ROOKIE";

  // 1) A single match artifact -> XP intent
  const matchPlayers = [
    { participantId: "P1", extra: { name: "Player One" } as JSONObject },
    { participantId: "P2", extra: { name: "Player Two" } as JSONObject },
  ];

  const matchArtifact = await makeArtifact({
    adapter,
    matchId: "M_REWARD_MATCH_001",
    seed: "seed-reward-match",
    participants: matchPlayers,
    universeCode,
    engineCode,
    engineVersion,
    modeCode,
    inputs: { participants: matchPlayers.map((p) => ({ participantId: p.participantId })), proof: { kind: "phase12" } } as JSONObject,
  });

  const matchRewards = produceRewardEventsFromMatchArtifactV1({ artifact: matchArtifact });

  // 2) A single-elim tournament completion -> badge + XP intents
  const deriver = new SingleEliminationDeriverV1();
  const tourPlayers = [
    { participantId: "P1", extra: { name: "Player One" } as JSONObject },
    { participantId: "P2", extra: { name: "Player Two" } as JSONObject },
    { participantId: "P3", extra: { name: "Player Three" } as JSONObject },
    { participantId: "P4", extra: { name: "Player Four" } as JSONObject },
  ];

  const tournament: TournamentV1 = {
    header: {
      tournamentVersion: "TournamentV1",
      tournamentId: "T_REWARD_SE_001",
      name: "Phase 12 Reward Proof — Single Elim",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "ACTIVE",
      universeCode,
      engineCode,
      engineVersion,
      modeCode,
      structure: "SINGLE_ELIMINATION",
      meta: { purpose: "phase12_rewards_proof" } as JSONObject,
    },
    participants: tourPlayers.map((p) => ({ participantId: p.participantId, label: p.participantId, extra: p.extra })),
    schedule: [
      { slotId: "QF1", round: 1, position: "A", participantIds: ["P1", "P2"], matchId: "M_R_QF1" },
      { slotId: "QF2", round: 1, position: "B", participantIds: ["P3", "P4"], matchId: "M_R_QF2" },
      { slotId: "FINAL", round: 2, position: "A", participantIds: ["TBD_QF1_WIN", "TBD_QF2_WIN"], matchId: "M_R_FINAL" },
    ],
    artifactIndex: [],
  };

  const baseInputs = (pids: string[]): JSONObject => ({
    participants: pids.map((participantId) => ({ participantId })),
    proof: { kind: "phase12_rewards_single_elim" },
  });

  const aQF1 = await makeArtifact({
    adapter,
    matchId: "M_R_QF1",
    seed: "seed-r-1",
    participants: tourPlayers.filter((p) => ["P1", "P2"].includes(p.participantId)),
    universeCode,
    engineCode,
    engineVersion,
    modeCode,
    inputs: baseInputs(["P1", "P2"]),
  });

  const aQF2 = await makeArtifact({
    adapter,
    matchId: "M_R_QF2",
    seed: "seed-r-2",
    participants: tourPlayers.filter((p) => ["P3", "P4"].includes(p.participantId)),
    universeCode,
    engineCode,
    engineVersion,
    modeCode,
    inputs: baseInputs(["P3", "P4"]),
  });

  const w1 = aQF1.result.winnerParticipantId!;
  const w2 = aQF2.result.winnerParticipantId!;

  const aFinal = await makeArtifact({
    adapter,
    matchId: "M_R_FINAL",
    seed: "seed-r-3",
    participants: tourPlayers.filter((p) => [w1, w2].includes(p.participantId)),
    universeCode,
    engineCode,
    engineVersion,
    modeCode,
    inputs: baseInputs([w1, w2]),
  });

  const tourArtifacts = [aQF1, aQF2, aFinal];

  const completedEvent = produceTournamentCompletedEventV1({
    tournament,
    artifacts: tourArtifacts,
    deriver,
    correlation: { requestId: "REQ_PHASE12_REWARDS" },
  });

  if (!completedEvent) throw new Error("Expected tournament.completed event to be emitted in rewards proof");

  const tournamentRewards = produceRewardEventsFromTournamentCompletedV1({ event: completedEvent });

  logJson("Match artifact summary", {
    matchId: matchArtifact.header.matchId,
    winner: matchArtifact.result.winnerParticipantId,
    hash: matchArtifact.deterministicHash.value,
  });

  logJson("Match reward intents", matchRewards);

  logJson("Tournament completed event summary", {
    tournamentId: completedEvent.correlation.tournamentId,
    completionKey: (completedEvent.meta as any)?.completionKey,
  });

  logJson("Tournament reward intents", tournamentRewards);

  // eslint-disable-next-line no-console
  console.log(
    `\nSUMMARY: matchRewards=${matchRewards.length} tournamentRewards=${tournamentRewards.length} total=${matchRewards.length + tournamentRewards.length}`
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
