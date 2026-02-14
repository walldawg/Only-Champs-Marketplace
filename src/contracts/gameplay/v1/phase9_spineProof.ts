/**
 * phase9_spineProof.ts — Minimal end-to-end proof of Phase 9 contract spine.
 *
 * Runs:
 * - validateDeck
 * - createMatch
 * - runMatch
 * - produceArtifact
 *
 * Prints:
 * - winner
 * - inputsDigest
 * - deterministicHash
 *
 * No DB. No Prisma. No platform wiring.
 *
 * Usage (example):
 *   npx -y tsx phase9_spineProof.ts
 */

import { InProcessMockEngineAdapterV1 } from "./InProcessMockEngineAdapterV1";
import type { JSONObject } from "./MatchArtifactV1";

function logJson(label: string, obj: unknown) {
  // eslint-disable-next-line no-console
  console.log(`\n== ${label} ==\n${JSON.stringify(obj, null, 2)}`);
}

async function main() {
  const adapter = new InProcessMockEngineAdapterV1();

  const universeCode = "UNIV_TEST";
  const engineCode = "MOCK_ENGINE";
  const engineVersion = "0.0.1";
  const modeCode = "ROOKIE";
  const matchId = "MATCH_TEST_001";
  const seed = "seed-12345";

  const participants = [
    { participantId: "P1", extra: { name: "Player One" } as JSONObject },
    { participantId: "P2", extra: { name: "Player Two" } as JSONObject },
  ];

  const inputs: JSONObject = {
    // Keep participants in inputs only to demonstrate a fully JSON packet;
    // platform would canonicalize ordering separately.
    participants: participants.map((p) => ({ participantId: p.participantId })),
    example: { hello: "world" },
  };

  // 1) validateDeck (optional in real runs; included here)
  const deckValidation = await adapter.validateDeck({
    universeCode,
    engineCode,
    engineVersion,
    modeCode,
    deckId: "DECK_001",
    cardVersionKeys: ["CARD_A", "CARD_B"],
    constraints: { ownedOnly: false },
  });

  logJson("validateDeck result", deckValidation);
  if (!deckValidation.ok) process.exitCode = 1;

  // 2) createMatch
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

  logJson("createMatch result", init);
  if (!init.ok || init.state === undefined) {
    process.exitCode = 1;
    return;
  }

  // 3) runMatch
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

  logJson("runMatch result", run);
  if (!run.ok || !run.outputs) {
    process.exitCode = 1;
    return;
  }

  // 4) produceArtifact
  const artifact = await adapter.produceArtifact({
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

  logJson("produced artifact (MatchArtifactV1)", artifact);

  // Summary
  // eslint-disable-next-line no-console
  console.log(
    `\nSUMMARY: winner=${artifact.result.winnerParticipantId ?? "none"} inputsDigest=${artifact.inputsDigest.value} deterministicHash=${artifact.deterministicHash.value}`
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
