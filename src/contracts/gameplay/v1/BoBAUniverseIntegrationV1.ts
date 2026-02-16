/**
 * BoBAUniverseIntegrationV1 — Concrete UniverseIntegrationV1 instance for BOBA.
 *
 * Purpose:
 * - Make the multiverse boundary real with a working universe onboarding record.
 * - Bind BOBA universe to BOBA_CORE engine + existing eligibility bridge.
 * - Declare interpretation approach without implementing mapping yet.
 *
 * Scope:
 * - Values only (no registry, no DB, no enforcement code).
 */

import type { UniverseIntegrationV1 } from "./UniverseIntegrationV1";
import type { JSONObject } from "./MatchArtifactV1";
import { BOBA_ENGINE_CODE, BOBA_ENGINE_VERSION } from "./BoBAEngineManifestV1";

export const BoBAUniverseIntegrationV1: UniverseIntegrationV1 = {
  integrationVersion: "UniverseIntegrationV1",
  integrationId: "UNIV_INTEGRATION_BOBA_V1",

  universe: {
    universeCode: "BOBA",
    displayName: "Bo Jackson Battle Arena",
    description: "BoBA universe integration (Phase 16: boundary record; gameplay handled by BOBA_CORE engine).",
  },

  authorizedEngines: [
    {
      engineCode: BOBA_ENGINE_CODE,
      engineVersion: BOBA_ENGINE_VERSION,
      modeCodes: ["ROOKIE", "SCORED"],
      notes: "BoBA core engine authorized for BOBA universe.",
    },
  ],

  allowedModeCodes: ["ROOKIE", "SCORED"],

  eligibilityPolicy: {
    policyId: "EligibilityBridgeV1:BOBA",
    expects: {
      deckId: true,
      cardVersionKeys: true,
      ownershipProof: true,
      modeCode: true,
      universeCode: true,
      extra: ["eventId", "tournamentId"],
    },
    notes: "Platform-side preflight gate before engine validation. Universe-specific rules may be layered later.",
    config: {
      universeCode: "BOBA",
      intent: "Block cross-universe decks; allow only owned+eligible card keys to proceed to engine.",
    } as unknown as JSONObject,
  },

  interpretationPolicy: {
    policyId: "InterpretationPolicyV1:BOBA",
    approach: "SHARED_TAXONOMY",
    describesInputs: {
      usesDeckCardKeys: true,
      usesDeckSlots: false,
      usesCardConceptTypes: true,
      usesCardVariantFields: true,
      extra: ["seed", "participants", "modeCode"],
    },
    notes:
      "BOBA currently intends to interpret platform concept types (HERO/PLAY/etc.) within the BOBA universe. " +
      "Actual mapping implementation is deferred; this record reserves the boundary.",
    config: {
      approach: "shared-taxonomy",
      note: "No mapping implementation in Phase 16; this is a declaration only.",
    } as unknown as JSONObject,
  },

  deckAcceptance: {
    requiredDeckTags: ["UNIVERSE:BOBA"],
    forbiddenDeckTags: ["UNIVERSE:*"],
    notes:
      "Initial stance: decks must be explicitly tagged for BOBA universe to run. " +
      "Tag enforcement is platform policy to be implemented later.",
  },

  publisher: {
    name: "OnlyChamps (local)",
    contact: "local",
  },

  extra: {
    phase: "Phase16-BoundaryRecord",
    note: "Universe integration record only; registry/enforcement comes later.",
  } as unknown as JSONObject,
};

export default BoBAUniverseIntegrationV1;
