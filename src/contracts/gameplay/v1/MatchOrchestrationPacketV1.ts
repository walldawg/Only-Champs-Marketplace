/**
 * MatchOrchestrationPacketV1 — Platform-owned envelope for running a match via EngineAdapter.
 *
 * Phase 9 Implementation Step 6 (Choice B: recordable):
 * - Shape is safe to persist for audit/debug.
 * - Still pure JSON + platform-level ids only (no Prisma).
 * - Not engine-facing; this is the platform's internal orchestration contract.
 */

import type { IdString, JSONObject, MatchArtifactV1 } from "./MatchArtifactV1";
import type { EngineBindingV1 } from "./EngineRegistryV1";
import type {
  CreateMatchInputV1,
  RunMatchInputV1,
  ProduceArtifactInputV1,
  ValidateDeckInputV1,
} from "./EngineAdapterV1";
import type {
  DeterminismExpectationV1,
  DeterminismHashBundleV1,
  CanonicalSerializationRuleSetV1,
} from "./DeterminismV1";

export const MATCH_ORCHESTRATION_PACKET_VERSION = "MatchOrchestrationPacketV1" as const;

/**
 * High-level match intent supplied by caller (API layer).
 * This is what gets normalized into engine-facing input packets.
 */
export interface MatchIntentV1 {
  universeCode: string;

  /** Optional mode hint. If omitted, platform may use binding.defaultModeCode. */
  modeCode?: string;

  /** Platform participants (unordered as provided; platform will canonicalize). */
  participants: Array<{
    participantId: IdString;
    label?: string;
    extra?: JSONObject;
  }>;

  /**
   * Sanitized inputs for engine. Must be JSON.
   * Platform is responsible for stable canonicalization & sorting.
   */
  inputs: JSONObject;

  /**
   * Optional deck validation context if the match requires deck constraints.
   * Still engine-agnostic; engine receives only cardVersionKeys + constraints.
   */
  deckContext?: {
    deckId?: IdString;
    cardVersionKeys: string[];
    constraints?: JSONObject;
  };

  /**
   * Optional caller metadata for audit/debug (never used for trust decisions).
   * Example: requestId, userId, clientVersion.
   */
  auditMeta?: JSONObject;
}

/**
 * Platform policies that affect deterministic processing and safety.
 * These can be persisted with the packet for audit/debug.
 */
export interface MatchPolicyV1 {
  /** Determinism expectation for this match/mode. */
  determinism: DeterminismExpectationV1;

  /** Canonical serialization rules used to build digests/hashes. */
  serializationRuleSet: CanonicalSerializationRuleSetV1;

  /** Sandbox limits the platform intends to enforce (if any). */
  sandbox?: {
    timeoutMs?: number;
    maxReplayBytes?: number;
    maxTimelineEvents?: number;
  };
}

/**
 * The resolved plan for running a match:
 * - Which engine binding applies
 * - Which modeCode will be used
 * - Canonical participant order
 * - Seed
 */
export interface MatchRunPlanV1 {
  binding: EngineBindingV1;

  /** Final selected mode (resolved from intent or binding default). */
  modeCode: string;

  /** Platform-supplied seed used for determinism. */
  seed: string;

  /** Participants in canonical order (platform-defined ordering). */
  participantsCanonical: Array<{
    participantId: IdString;
    label?: string;
    extra?: JSONObject;
  }>;
}

/**
 * The full orchestration packet. Safe to persist.
 */
export interface MatchOrchestrationPacketV1 {
  packetVersion: typeof MATCH_ORCHESTRATION_PACKET_VERSION;

  /** Platform match id (minted once). */
  matchId: IdString;

  /** ISO-8601 created timestamp (platform time). */
  createdAt: string;

  /** Optional ISO-8601 completed timestamp when orchestration finishes. */
  completedAt?: string;

  /** Input intent from caller (sanitized). */
  intent: MatchIntentV1;

  /** Platform policies in effect. */
  policy: MatchPolicyV1;

  /** Resolved run plan. */
  plan: MatchRunPlanV1;

  /**
   * Engine-facing packets derived from intent+plan.
   * These are persisted for audit/debug and to enable re-runs.
   */
  enginePackets: {
    validateDeck?: ValidateDeckInputV1;
    createMatch: CreateMatchInputV1;
    runMatch: RunMatchInputV1;
    produceArtifact: ProduceArtifactInputV1;
  };

  /**
   * Determinism bundle used to compute inputsDigest + deterministicHash.
   * Persisting this makes verification reproducible across services.
   */
  determinismBundle: DeterminismHashBundleV1;

  /**
   * Outputs captured during orchestration (safe to persist).
   * Platform may omit large fields depending on storage policy.
   */
  outputs?: {
    /** Engine runMatch outputs (opaque JSON). */
    runOutputs?: JSONObject;

    /** Final produced artifact. */
    artifact?: MatchArtifactV1;

    /** Optional platform-side notes (audit/debug only). */
    notes?: JSONObject;
  };
}
