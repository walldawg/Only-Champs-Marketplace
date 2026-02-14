/**
 * phase16_universeBoundaryProof.ts — Boundary certification harness (Milestone F — Ticket F6).
 *
 * Proves deterministic containment at pre-setup:
 * 1) Universe missing -> blocked
 * 2) Engine not authorized -> blocked
 * 3) Mode not allowed -> blocked
 * 4) Deck missing required tag -> blocked
 * 5) Valid BOBA preflight -> OK
 * 6) Setup snapshot captured with frozen universe+engine+mode
 *
 * Usage:
 *   npx -y tsx src/contracts/gameplay/v1/phase16_universeBoundaryProof.ts
 */

import { createUniverseIntegrationRegistryV1 } from "./UniverseIntegrationRegistryV1";
import { runUniverseMatchPreflightV1 } from "./UniverseMatchPreflightV1";
import { createMatchSetupSnapshotV1 } from "./MatchSetupSnapshotV1";
import { BoBAUniverseIntegrationV1 } from "./BoBAUniverseIntegrationV1";

function logCase(name: string, obj: unknown) {
  // eslint-disable-next-line no-console
  console.log(`\n== ${name} ==\n${JSON.stringify(obj, null, 2)}`);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`);
}

async function main() {
  const registry = createUniverseIntegrationRegistryV1([BoBAUniverseIntegrationV1]);

  // Case 1: Universe missing
  const c1 = runUniverseMatchPreflightV1({
    registry,
    universeCode: "NOPE",
    engineCode: "BOBA_CORE",
    engineVersion: "0.1.0",
    modeCode: "ROOKIE",
    deckTags: ["UNIVERSE:BOBA"],
  });
  logCase("Case 1 — Universe missing", c1);
  assert(c1.ok === false && c1.violationCode === "V_UNIVERSE_NOT_FOUND", "Case 1 should be universe not found");

  // Case 2: Engine not authorized
  const c2 = runUniverseMatchPreflightV1({
    registry,
    universeCode: "BOBA",
    engineCode: "SOME_OTHER_ENGINE",
    engineVersion: "9.9.9",
    modeCode: "ROOKIE",
    deckTags: ["UNIVERSE:BOBA"],
  });
  logCase("Case 2 — Engine not authorized", c2);
  assert(c2.ok === false && c2.violationCode === "V_ENGINE_NOT_AUTHORIZED", "Case 2 should be engine not authorized");

  // Case 3: Mode not allowed (universe)
  const c3 = runUniverseMatchPreflightV1({
    registry,
    universeCode: "BOBA",
    engineCode: "BOBA_CORE",
    engineVersion: "0.1.0",
    modeCode: "PLAYMAKER",
    deckTags: ["UNIVERSE:BOBA"],
  });
  logCase("Case 3 — Mode not allowed", c3);
  assert(c3.ok === false && c3.violationCode === "V_MODE_NOT_ALLOWED", "Case 3 should be mode not allowed");

  // Case 4: Missing required deck tag
  const c4 = runUniverseMatchPreflightV1({
    registry,
    universeCode: "BOBA",
    engineCode: "BOBA_CORE",
    engineVersion: "0.1.0",
    modeCode: "ROOKIE",
    deckTags: ["UNIVERSE:NOT_BOBA"],
  });
  logCase("Case 4 — Missing required deck tag", c4);
  assert(c4.ok === false && c4.violationCode === "V_DECK_MISSING_REQUIRED_TAG", "Case 4 should be missing required tag");

  // Case 5: Valid BOBA preflight
  const c5 = runUniverseMatchPreflightV1({
    registry,
    universeCode: "BOBA",
    engineCode: "BOBA_CORE",
    engineVersion: "0.1.0",
    modeCode: "ROOKIE",
    deckTags: ["UNIVERSE:BOBA"],
  });
  logCase("Case 5 — Valid BOBA preflight", c5);
  assert(c5.ok === true && c5.violationCode === "OK", "Case 5 should be OK");

  // Case 6: Capture setup snapshot when OK
  const snapshot = createMatchSetupSnapshotV1({
    snapshotId: "SNAPSHOT_001",
    matchId: "MATCH_001",
    universeCode: "BOBA",
    universeIntegrationId: BoBAUniverseIntegrationV1.integrationId,
    engineCode: "BOBA_CORE",
    engineVersion: "0.1.0",
    modeCode: "ROOKIE",
    deckId: "DECK_001",
    deckTags: ["UNIVERSE:BOBA"],
    extra: { note: "Phase16 proof snapshot" },
  });
  logCase("Case 6 — Setup snapshot", snapshot);

  // SUMMARY
  // eslint-disable-next-line no-console
  console.log(
    `\nSUMMARY: cases=6 okCases=1 blockedCases=4 snapshotUniverse=${snapshot.universeCode} snapshotIntegrationId=${snapshot.universeIntegrationId}`
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
