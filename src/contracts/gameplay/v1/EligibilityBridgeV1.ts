/**
 * EligibilityBridgeV1 — Runtime bridge from EligibilityPacketV1 to EngineAdapter.validateDeck inputs.
 *
 * Phase 11 Step 2:
 * - Pure transformation + guard (no DB calls, no Prisma, no engine logic)
 * - Enforces platform eligibility decision BEFORE engine validation if requested
 *
 * Default policy (minimal):
 * - If packet.decision === "INELIGIBLE" => throw Error
 * - If packet.decision === "UNKNOWN" => throw Error unless allowUnknown=true
 * - If packet.decision === "ELIGIBLE" => produce bridge payload
 *
 * Notes:
 * - Engines should still validate deck structure/rules; this bridge only handles ownership eligibility gating.
 */

import type { EligibilityPacketV1, EligibilityToValidateDeckBridgeV1 } from "./EligibilityPacketV1";
import type { IdString } from "./MatchArtifactV1";

export interface BuildValidateDeckBridgeOptionsV1 {
  /** If true, allow decision=UNKNOWN to pass through (mode policy). Default false. */
  allowUnknown?: boolean;

  /** If true, include eligibilityPacketId on the bridge payload. Default true. */
  includePacketId?: boolean;
}

export class EligibilityDecisionErrorV1 extends Error {
  readonly code: "ELIGIBILITY_INELIGIBLE" | "ELIGIBILITY_UNKNOWN";
  readonly eligibilityPacketId?: IdString;

  constructor(params: { code: "ELIGIBILITY_INELIGIBLE" | "ELIGIBILITY_UNKNOWN"; message: string; eligibilityPacketId?: IdString }) {
    super(params.message);
    this.code = params.code;
    this.eligibilityPacketId = params.eligibilityPacketId;
  }
}

/**
 * Build a validateDeck bridge payload from an eligibility packet.
 *
 * IMPORTANT:
 * - This function does NOT know engineCode/engineVersion. Those belong to the match/tournament context.
 * - Caller must supply engine binding (universeCode/engineCode/engineVersion/modeCode) from the orchestration context.
 */
export function buildValidateDeckBridgeFromEligibilityPacketV1(params: {
  packet: EligibilityPacketV1;

  universeCode: string;
  engineCode: string;
  engineVersion: string;
  modeCode: string;

  options?: BuildValidateDeckBridgeOptionsV1;
}): EligibilityToValidateDeckBridgeV1 {
  const { packet, universeCode, engineCode, engineVersion, modeCode } = params;
  const options = params.options ?? {};

  if (packet.decision === "INELIGIBLE") {
    throw new EligibilityDecisionErrorV1({
      code: "ELIGIBILITY_INELIGIBLE",
      message: `Eligibility packet decision is INELIGIBLE (packetId=${packet.eligibilityPacketId})`,
      eligibilityPacketId: packet.eligibilityPacketId,
    });
  }

  if (packet.decision === "UNKNOWN" && !options.allowUnknown) {
    throw new EligibilityDecisionErrorV1({
      code: "ELIGIBILITY_UNKNOWN",
      message: `Eligibility packet decision is UNKNOWN and allowUnknown=false (packetId=${packet.eligibilityPacketId})`,
      eligibilityPacketId: packet.eligibilityPacketId,
    });
  }

  // Collect cardVersionKeys by expanding quantity.
  const keys: string[] = [];
  for (const claim of packet.deck.claims) {
    const qty = Math.max(0, Math.floor(claim.quantity));
    for (let i = 0; i < qty; i++) keys.push(claim.cardVersionKey);
  }

  const bridge: EligibilityToValidateDeckBridgeV1 = {
    universeCode,
    engineCode,
    engineVersion,
    modeCode,
    deckId: packet.deck.deckId,
    cardVersionKeys: keys,
    constraints: packet.deck.constraints,
    eligibilityDecision: packet.decision,
    eligibilityPacketId: options.includePacketId === false ? undefined : packet.eligibilityPacketId,
  };

  return bridge;
}

export default buildValidateDeckBridgeFromEligibilityPacketV1;
