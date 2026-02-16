/**
 * phase11_eligibilityProof.ts — Minimal proof: EligibilityPacketV1 -> bridge -> validateDeck.
 *
 * Phase 11 Proof:
 * - Builds an EligibilityPacketV1 with claims
 * - Uses EligibilityBridgeV1 to produce EligibilityToValidateDeckBridgeV1
 * - Calls InProcessMockEngineAdapterV1.validateDeck with the derived cardVersionKeys
 *
 * This proves the ownership/eligibility layer can gate BEFORE engine calls,
 * while still passing deck structure to the engine for rule validation.
 *
 * Usage:
 *   npx -y tsx src/contracts/gameplay/v1/phase11_eligibilityProof.ts
 */

import { InProcessMockEngineAdapterV1 } from "./InProcessMockEngineAdapterV1";
import { buildValidateDeckBridgeFromEligibilityPacketV1 } from "./EligibilityBridgeV1";
import type { EligibilityPacketV1 } from "./EligibilityPacketV1";
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

  const packet: EligibilityPacketV1 = {
    packetVersion: "EligibilityPacketV1",
    eligibilityPacketId: "ELIG_PKT_001",
    issuedAt: new Date().toISOString(),
    requester: { userId: "USER_1", participantId: "P1", clientId: "local-proof" },
    context: { universeCode, modeCode, tournamentId: "T_ROUNDROBIN_001" },
    deck: {
      deckId: "DECK_001",
      deckName: "Proof Deck",
      participantId: "P1",
      claims: [
        { cardVersionKey: "CARD_A", quantity: 2, claimKind: "OWNERSHIP_RECORD", refs: { ownershipId: "OWN_123" } },
        { cardVersionKey: "CARD_B", quantity: 1, claimKind: "OWNERSHIP_RECORD", refs: { ownershipId: "OWN_456" } },
      ],
      constraints: { ownedOnly: true } as JSONObject,
      auditMeta: { note: "Phase 11 proof packet" } as JSONObject,
    },
    decision: "ELIGIBLE",
    reasons: [{ code: "OWNERSHIP_VERIFIED", message: "All claimed cards verified in ownership records." }],
    extra: { proof: "phase11" } as JSONObject,
  };

  const bridge = buildValidateDeckBridgeFromEligibilityPacketV1({
    packet,
    universeCode,
    engineCode,
    engineVersion,
    modeCode,
    options: { allowUnknown: false, includePacketId: true },
  });

  logJson("Eligibility packet", packet);
  logJson("Bridge payload (to validateDeck)", bridge);

  const result = await adapter.validateDeck({
    universeCode: bridge.universeCode,
    engineCode: bridge.engineCode,
    engineVersion: bridge.engineVersion,
    modeCode: bridge.modeCode,
    deckId: bridge.deckId,
    cardVersionKeys: bridge.cardVersionKeys,
    constraints: bridge.constraints,
  });

  logJson("validateDeck result", result);

  // eslint-disable-next-line no-console
  console.log(
    `\nSUMMARY: decision=${packet.decision} cardKeys=${bridge.cardVersionKeys.length} validateOk=${result.ok ? "yes" : "no"}`
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
