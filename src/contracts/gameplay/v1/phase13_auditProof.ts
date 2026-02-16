/**
 * phase13_auditProof.ts — Minimal proof: deterministic verifier detects tampering.
 *
 * Phase 13 Proof:
 * 1) Generate MatchArtifactV1 (mock engine)
 * 2) Verify -> VERIFIED
 * 3) Tamper artifact.result.scoresByParticipantId
 * 4) Verify -> HASH_MISMATCH
 *
 * Usage:
 *   npx -y tsx src/contracts/gameplay/v1/phase13_auditProof.ts
 */

import { InProcessMockEngineAdapterV1 } from "./InProcessMockEngineAdapterV1";
import { verifyMatchArtifactDeterminismV1 } from "./AuditVerifierV1";
import type { JSONObject, MatchArtifactV1 } from "./MatchArtifactV1";

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

  if (!init.ok || init.state === undefined) throw new Error("createMatch failed in audit proof");

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

  if (!run.ok || !run.outputs) throw new Error("runMatch failed in audit proof");

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

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

async function main() {
  const adapter = new InProcessMockEngineAdapterV1();

  const universeCode = "UNIV_TEST";
  const engineCode = "MOCK_ENGINE";
  const engineVersion = "0.0.1";
  const modeCode = "ROOKIE";

  const participants = [
    { participantId: "P1", extra: { name: "Player One" } as JSONObject },
    { participantId: "P2", extra: { name: "Player Two" } as JSONObject },
  ];

  const artifact = await makeArtifact({
    adapter,
    matchId: "M_AUDIT_001",
    seed: "seed-audit-1",
    participants,
    universeCode,
    engineCode,
    engineVersion,
    modeCode,
    inputs: { participants: participants.map((p) => ({ participantId: p.participantId })), proof: { kind: "phase13" } } as JSONObject,
  });

  const audit1 = verifyMatchArtifactDeterminismV1({ artifact });

  // Tamper: flip a score value (allowed-field tampering)
  const tampered: MatchArtifactV1 = deepClone(artifact);
  const winner = tampered.result.winnerParticipantId ?? "P1";
  const loser = winner === "P1" ? "P2" : "P1";
  tampered.result.scoresByParticipantId = tampered.result.scoresByParticipantId ?? ({} as any);
  // force a change
  (tampered.result.scoresByParticipantId as any)[winner] = ((tampered.result.scoresByParticipantId as any)[winner] ?? 0) + 99;
  (tampered.result.scoresByParticipantId as any)[loser] = ((tampered.result.scoresByParticipantId as any)[loser] ?? 0);

  const audit2 = verifyMatchArtifactDeterminismV1({ artifact: tampered });

  logJson("Original artifact summary", {
    matchId: artifact.header.matchId,
    expectedHash: artifact.deterministicHash.value,
    winner: artifact.result.winnerParticipantId,
    scores: artifact.result.scoresByParticipantId,
  });

  logJson("Audit #1 (original)", audit1);

  logJson("Tampered artifact summary", {
    matchId: tampered.header.matchId,
    expectedHash: tampered.deterministicHash.value,
    winner: tampered.result.winnerParticipantId,
    scores: tampered.result.scoresByParticipantId,
  });

  logJson("Audit #2 (tampered)", audit2);

  // eslint-disable-next-line no-console
  console.log(
    `\nSUMMARY: original=${audit1.status} recomputed=${audit1.comparison?.recomputedDeterministicHash} tampered=${audit2.status} recomputed=${audit2.comparison?.recomputedDeterministicHash}`
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
