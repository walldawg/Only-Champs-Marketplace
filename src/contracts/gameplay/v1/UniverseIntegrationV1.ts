/**
 * UniverseIntegrationV1 — Minimal universe onboarding contract for OnlyChamps Marketplace.
 *
 * Purpose:
 * - Define the required "setup boundary" a Universe must declare before gameplay can run.
 * - Keep platform neutral: marketplace decks remain universe-agnostic, meaning is universe-scoped.
 * - Provide slots for:
 *   (1) Authorized engines
 *   (2) Eligibility gating (platform + universe policy)
 *   (3) Interpretation policy (how a deck becomes engine inputs) — reference only, not implementation.
 *
 * Scope:
 * - Types only (no Prisma, no adapters, no registry).
 * - Intentionally conservative to avoid forcing early multiverse design.
 */

import type { IdString, JSONObject } from "./MatchArtifactV1";

export const UNIVERSE_INTEGRATION_VERSION = "UniverseIntegrationV1" as const;

/** Stable identifier for a universe (e.g., "BOBA"). */
export type UniverseCodeV1 = string;

/** Stable identifier for a mode as seen by the platform (e.g., "ROOKIE"). */
export type ModeCodeV1 = string;

/** Stable identifier for an engine (e.g., "BOBA_CORE"). */
export type EngineCodeV1 = string;

/** Stable identifier for an engine version (e.g., "0.1.0"). */
export type EngineVersionV1 = string;

/**
 * Declares which engines are permitted to execute gameplay for this universe.
 * Platform must enforce: matches for this universe may only use these engines.
 */
export interface AuthorizedEngineV1 {
  engineCode: EngineCodeV1;
  engineVersion: EngineVersionV1;

  /** Optional: universe may restrict which platform modes can be executed by this engine. */
  modeCodes?: ModeCodeV1[];

  /** Optional human notes (e.g., "rookie-only until v0.2"). */
  notes?: string;
}

/**
 * Eligibility gating is the platform’s "do we even ask the engine?" boundary.
 *
 * This contract does not implement gating; it references the policy that will be used.
 */
export interface UniverseEligibilityPolicyRefV1 {
  /**
   * Policy id / name for traceability. Example:
   * - "EligibilityBridgeV1"
   * - "EligibilityBridgeV1:BOBA"
   */
  policyId: string;

  /**
   * Optional: minimal inputs the policy expects from the platform.
   * Keep this high-level (no schema commitments).
   */
  expects?: {
    deckId?: boolean;
    cardVersionKeys?: boolean;
    ownershipProof?: boolean;
    modeCode?: boolean;
    universeCode?: boolean;
    extra?: string[]; // named flags only
  };

  /** Optional extra notes. */
  notes?: string;

  /** Optional universe-specific knobs (values only). */
  config?: JSONObject;
}

/**
 * Interpretation is where "meaning" lives:
 * - Same card can mean different things in different universes/games.
 *
 * This is a reference slot only. Implementation lives in a future phase.
 */
export interface UniverseInterpretationPolicyRefV1 {
  /**
   * Policy id / name for traceability. Example:
   * - "InterpretationPolicyV1:BOBA"
   * - "InterpretationPolicyV1:DOGFIGHT"
   */
  policyId: string;

  /**
   * Optional: declares the intended mapping approach without enforcing it.
   */
  approach?: "SHARED_TAXONOMY" | "UNIVERSE_TAXONOMY" | "HYBRID";

  /**
   * Optional: high-level declarations about what the engine expects as "inputs".
   * This is descriptive only; MatchOrchestrationPacketV1 carries runtime inputs.
   */
  describesInputs?: {
    usesDeckCardKeys?: boolean;
    usesDeckSlots?: boolean;
    usesCardConceptTypes?: boolean;
    usesCardVariantFields?: boolean;
    extra?: string[]; // named flags only
  };

  /** Optional extra notes. */
  notes?: string;

  /** Optional universe-specific knobs (values only). */
  config?: JSONObject;
}

/**
 * UniverseIntegrationV1 is the minimum onboarding artifact for a universe/game family.
 *
 * Platform guarantees:
 * - Decks remain marketplace assets (universe-agnostic)
 * - Meaning is applied only inside a universe when building engine inputs
 * - Engines cannot execute outside authorized universe bindings
 */
export interface UniverseIntegrationV1 {
  integrationVersion: typeof UNIVERSE_INTEGRATION_VERSION;

  /** Stable id for this integration record. */
  integrationId: IdString;

  /** Universe identity. */
  universe: {
    universeCode: UniverseCodeV1;
    displayName?: string;
    description?: string;
  };

  /** Which engines are allowed to execute gameplay for this universe. */
  authorizedEngines: AuthorizedEngineV1[];

  /** Which platform modes are permitted in this universe (optional gate). */
  allowedModeCodes?: ModeCodeV1[];

  /** Eligibility boundary (platform-side pre-flight gate). */
  eligibilityPolicy: UniverseEligibilityPolicyRefV1;

  /** Interpretation boundary (universe-side meaning/mapping). */
  interpretationPolicy: UniverseInterpretationPolicyRefV1;

  /**
   * Optional: basic “deck acceptance” declarations, values-only.
   * This is NOT a validation schema; it is a universe declaration.
   */
  deckAcceptance?: {
    /** Optional: required tags/labels on decks to be eligible for this universe. */
    requiredDeckTags?: string[];

    /** Optional: forbid certain deck tags/labels. */
    forbiddenDeckTags?: string[];

    /** Optional: default constraints the engine validator will likely enforce. */
    notes?: string;
  };

  /** Optional provenance. */
  publisher?: {
    orgId?: IdString;
    name?: string;
    contact?: string;
  };

  /** Optional extra metadata. */
  extra?: JSONObject;
}
