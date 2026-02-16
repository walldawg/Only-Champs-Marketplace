/**
 * EngineAdapterV1 — Minimal platform-facing engine contract.
 *
 * Constraints:
 * - Pure JSON inputs/outputs (no Prisma/DB types, no classes).
 * - Minimal shapes; engines may carry richer data in `extra` fields.
 * - No implementation, no registry, no wiring (Phase 9 Implementation Step 2).
 */

import type { IdString, JSONObject, JSONValue, MatchArtifactV1 } from "./MatchArtifactV1";

export const ENGINE_ADAPTER_VERSION = "EngineAdapterV1" as const;

/** Common envelope for errors without constraining engine internals. */
export interface EngineErrorV1 {
  code: string;          // stable, machine-readable (e.g., "DECK_INVALID", "TIMEOUT")
  message: string;       // human-readable
  details?: JSONObject;  // optional structured detail (JSON only)
}

/** validateDeck(input) -> DeckValidationResult */
export interface ValidateDeckInputV1 {
  universeCode: string;
  engineCode: string;
  engineVersion: string;
  modeCode: string;

  /** Platform deck id being validated (optional for engines that validate by card list only). */
  deckId?: IdString;

  /** Card identity list (typically version keys). */
  cardVersionKeys: string[];

  /**
   * Optional constraints packet from platform/marketplace (engine-agnostic).
   * Example: { "ownedOnly": true, "maxCopies": 1 }
   */
  constraints?: JSONObject;

  /** Engine may receive additional context; platform treats it as opaque JSON. */
  extra?: JSONObject;
}

export interface DeckValidationResultV1 {
  ok: boolean;
  errors?: EngineErrorV1[];

  /** Optional normalized hints (never mutates deck; informational only). */
  warnings?: EngineErrorV1[];

  /** Engine-defined metadata, safe JSON only. */
  extra?: JSONObject;
}

/** createMatch(input) -> MatchInit */
export interface CreateMatchInputV1 {
  universeCode: string;
  engineCode: string;
  engineVersion: string;
  modeCode: string;

  /** Platform match id (platform mints; engine must not). */
  matchId: IdString;

  /** Platform participants (player/team ids). */
  participants: Array<{ participantId: IdString; extra?: JSONObject }>;

  /** Platform-supplied seed for determinism (string to avoid numeric range issues). */
  seed: string;

  /**
   * Sanitized inputs packet for the engine.
   * Must be fully JSON and stable-serializable (platform controls ordering/serialization).
   */
  inputs: JSONObject;

  /** Optional engine context (opaque to platform). */
  extra?: JSONObject;
}

export interface MatchInitV1 {
  ok: boolean;
  errors?: EngineErrorV1[];

  /**
   * Engine-defined initial state (JSON only).
   * Platform stores/transmits this only if needed; it must remain JSON.
   */
  state?: JSONValue;

  /** Engine-defined metadata. */
  extra?: JSONObject;
}

/** runMatch(input) -> MatchResult */
export interface RunMatchInputV1 {
  universeCode: string;
  engineCode: string;
  engineVersion: string;
  modeCode: string;

  matchId: IdString;
  seed: string;

  /** State returned from createMatch (or previously stored), JSON only. */
  state: JSONValue;

  /** Same sanitized inputs used to create the match (platform may resend for safety). */
  inputs: JSONObject;

  /** Optional engine context (opaque). */
  extra?: JSONObject;
}

export interface RunMatchResultV1 {
  ok: boolean;
  errors?: EngineErrorV1[];

  /**
   * Engine-defined final state (optional). If unused, omit.
   * Must be JSON.
   */
  finalState?: JSONValue;

  /**
   * Engine-defined output bundle that produceArtifact can consume.
   * Platform treats it as opaque JSON.
   */
  outputs?: JSONObject;

  /** Engine-defined metadata. */
  extra?: JSONObject;
}

/** produceArtifact(input) -> MatchArtifactV1 */
export interface ProduceArtifactInputV1 {
  universeCode: string;
  engineCode: string;
  engineVersion: string;
  modeCode: string;

  matchId: IdString;
  seed: string;

  participants: Array<{ participantId: IdString; extra?: JSONObject }>;

  /** Sanitized inputs used for digest + determinism binding. */
  inputs: JSONObject;

  /** Engine outputs from runMatch (opaque JSON). */
  outputs: JSONObject;

  /** Optional engine context. */
  extra?: JSONObject;
}

/**
 * Minimal EngineAdapter contract.
 *
 * IMPORTANT:
 * - Every method MUST be referentially transparent with respect to:
 *   {seed, inputs, participants, mode, engineVersion} for determinism verification.
 * - Engines must not access platform DB; only these packets.
 */
export interface EngineAdapterV1 {
  readonly adapterVersion: typeof ENGINE_ADAPTER_VERSION;

  validateDeck(input: ValidateDeckInputV1): Promise<DeckValidationResultV1>;

  createMatch(input: CreateMatchInputV1): Promise<MatchInitV1>;

  runMatch(input: RunMatchInputV1): Promise<RunMatchResultV1>;

  produceArtifact(input: ProduceArtifactInputV1): Promise<MatchArtifactV1>;
}
