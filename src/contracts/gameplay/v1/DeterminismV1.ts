/**
 * DeterminismV1 — Platform-level types for deterministic verification.
 *
 * Phase 9 Implementation Step 5:
 * - Types + deterministic "hash input bundle" shape only
 * - No hashing implementation, no crypto dependency, no storage assumptions
 *
 * Purpose:
 * - Make it unambiguous what data is bound into inputsDigest and deterministicHash.
 * - Provide a single canonical bundle the platform can serialize in a stable way.
 */

import type { JSONObject, JSONValue, IdString } from "./MatchArtifactV1";

export const DETERMINISM_CONTRACT_VERSION = "DeterminismContractV1" as const;

/**
 * Canonical serialization rules are POLICY, not code here.
 * This type exists so the platform can record which ruleset was used.
 */
export type CanonicalSerializationRuleSetV1 =
  | "stable-json:v1"
  | "stable-json:v1+sorted-keys"
  | "stable-json:v1+sorted-keys+sorted-arrays";

/**
 * The exact bundle that should be serialized and hashed to compute:
 * - inputsDigest (platform digest of sanitized inputs)
 * - deterministicHash (binds seed + inputs + outputs)
 *
 * Engines and platform must agree on how this bundle is serialized.
 */
export interface DeterminismHashBundleV1 {
  contractVersion: typeof DETERMINISM_CONTRACT_VERSION;

  /** Which canonical serialization ruleset was used for stable hashing. */
  serialization: {
    ruleSet: CanonicalSerializationRuleSetV1;

    /**
     * Optional notes; never used for trust decisions.
     * Example: "arrays sorted only where order is declared irrelevant"
     */
    notes?: string;
  };

  /** Routing fields (must match artifact header). */
  header: {
    universeCode: string;
    engineCode: string;
    engineVersion: string;
    modeCode: string;
    matchId: IdString;
  };

  /**
   * Seed supplied by platform.
   * Stored as string to preserve exact value across languages.
   */
  seed: string;

  /**
   * Participants in canonical order.
   * Platform must supply a canonical order (e.g., sorted by participantId).
   */
  participants: Array<{
    participantId: IdString;
    /** Optional participant metadata included in determinism binding (JSON). */
    extra?: JSONObject;
  }>;

  /**
   * Sanitized inputs packet, already canonicalized by the platform
   * (e.g., stable ordering, normalized primitives).
   */
  inputs: JSONObject;

  /**
   * Engine outputs used to derive the artifact timeline/result/replay.
   * Platform treats this as opaque JSON, but it is included in determinism binding.
   */
  outputs: JSONObject;

  /**
   * Optional: if the engine emits timeline/result/replay directly without a separate outputs bundle,
   * platform may bind those instead. Keep this field for future flexibility.
   */
  derived?: {
    timeline?: JSONValue;
    result?: JSONValue;
    replay?: JSONValue;
  };
}

/**
 * A platform-facing declaration of determinism expectations.
 * Useful for gating competitive modes later without changing engines.
 */
export interface DeterminismExpectationV1 {
  contractVersion: typeof DETERMINISM_CONTRACT_VERSION;

  /**
   * FULL: same seed+inputs+participants => same deterministicHash AND same winner/placements
   * PARTIAL: deterministicHash may differ, but competitive outcome fields must match
   * NONE: no determinism guarantees (should not be eligible for tournaments)
   */
  level: "FULL" | "PARTIAL" | "NONE";

  /**
   * Which fields must remain invariant for PARTIAL determinism.
   * Example: ["result.winnerParticipantId", "result.placements", "result.scoresByParticipantId"]
   */
  requiredInvariantPaths?: string[];
}

/**
 * Minimal record the platform can store when verifying a deterministic run.
 */
export interface DeterminismVerificationRecordV1 {
  contractVersion: typeof DETERMINISM_CONTRACT_VERSION;

  /** Digest algorithm used for inputsDigest. */
  inputsDigestAlgo: string;

  /** Hash algorithm used for deterministicHash. */
  deterministicHashAlgo: string;

  /** Canonical serialization ruleset used. */
  serializationRuleSet: CanonicalSerializationRuleSetV1;

  /** Whether verification passed. */
  ok: boolean;

  /** Optional failure reason code if not ok. */
  failureCode?: string;

  /** Optional details, JSON only. */
  details?: JSONObject;
}
