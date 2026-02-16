/**
 * MatchArtifactV1 — Platform-level, engine-agnostic match "receipt".
 *
 * Goals:
 * - Pure JSON shape (no Prisma/DB types, no class instances).
 * - Stable serialization & hashing support (inputsDigest + deterministicHash).
 * - Timeline is standardized enough for platform features, while allowing engine-specific
 *   payloads in a safe "extra" field.
 *
 * Non-goals (Phase 9 Step 1):
 * - No persistence schema
 * - No adapter/registry implementation
 * - No engine calls
 */

export const MATCH_ARTIFACT_VERSION = "MatchArtifactV1" as const;

/** JSON primitives and containers (for opaque replay/engine payloads). */
export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONObject | JSONArray;
export interface JSONObject {
  [key: string]: JSONValue;
}
export type JSONArray = JSONValue[];

/**
 * A stable identifier string (UUID, ULID, or any platform-chosen format).
 * Intentionally not constrained here to avoid leaking storage assumptions.
 */
export type IdString = string;

/**
 * Artifact metadata that enables platform routing without knowing the engine.
 */
export interface MatchArtifactHeaderV1 {
  /** Must equal "MatchArtifactV1". */
  artifactVersion: typeof MATCH_ARTIFACT_VERSION;

  /** Universe this match belongs to (e.g., "BOBA"). */
  universeCode: string;

  /** Engine identity (e.g., "BOBA_CORE"). */
  engineCode: string;

  /** Engine version locked for the match/tournament (semver-like string). */
  engineVersion: string;

  /** Mode identity inside the engine (e.g., "ROOKIE", "SUBSTITUTION"). */
  modeCode: string;

  /** Platform match identifier. */
  matchId: IdString;

  /** ISO-8601 timestamp for when the match started (platform time). */
  startedAt: string;

  /** ISO-8601 timestamp for when the match completed (platform time). */
  completedAt: string;
}

/**
 * Participants are platform-owned identifiers. Engines should not mint them.
 * `role` supports 1v1, teams, or multi-participant games without forcing a model.
 */
export interface MatchParticipantV1 {
  /** Platform participant id (player id, team id, etc.). */
  participantId: IdString;

  /** Optional display label captured at time of match (for audit/replay friendliness). */
  label?: string;

  /** Optional role hint, engine-defined (e.g., "PLAYER", "TEAM", "AI"). */
  role?: string;

  /**
   * Engine-defined participant metadata that is safe to store.
   * Must be JSON-serializable.
   */
  extra?: JSONObject;
}

/**
 * Digest of the key sanitized inputs used to run the match.
 * This is not necessarily a cryptographic hash; the platform may define the algorithm.
 */
export interface InputsDigestV1 {
  /**
   * An identifier for the digest algorithm/version used
   * (e.g., "sha256:v1", "blake3:v1", "stable-json:sha256:v1").
   */
  algo: string;

  /** Hex/base64 digest string produced by the platform or engine (as specified by contract). */
  value: string;

  /**
   * Optional human-debuggable summary for audit logs (never used for trust decisions).
   * Example: "seed=1234; p1=...; p2=...; deckA=...; deckB=..."
   */
  debugHint?: string;
}

/**
 * Deterministic hash that binds seed + sanitized inputs + produced outputs.
 * Platform uses this to verify "same inputs + same seed => same results".
 */
export interface DeterministicHashV1 {
  /** Algorithm/version label. */
  algo: string;

  /** Hex/base64 hash string. */
  value: string;
}

/**
 * A standardized timeline event. Engines may emit richer details in `extra`.
 * Platform features should rely only on stable top-level fields.
 */
export interface MatchTimelineEventV1 {
  /** Monotonic index of event in the timeline (0..n-1). */
  idx: number;

  /** Engine-defined event code (e.g., "TURN_START", "PLAY_RESOLVED"). */
  code: string;

  /** ISO-8601 timestamp when recorded (platform time). */
  at: string;

  /**
   * Optional participant reference this event is primarily about.
   * Should match a participantId in `participants`.
   */
  participantId?: IdString;

  /**
   * Optional numeric delta or score snapshot to help platform summaries.
   * Engines should keep these stable if used.
   */
  metrics?: Record<string, number>;

  /**
   * Engine-defined event payload (must be JSON).
   * The platform treats this as opaque and must not depend on its internal structure.
   */
  extra?: JSONObject;
}

/**
 * Minimal result payload the platform can use for standings and rewards.
 * For games that do not have a single winner, use placements and/or scoringSummary.
 */
export interface MatchResultV1 {
  /** Optional winner participantId (for winner-take-all games). */
  winnerParticipantId?: IdString;

  /**
   * Placement results (1 = best). For ties, engines may repeat the same placement number.
   * Example: [{ participantId: "p1", placement: 1 }, { participantId: "p2", placement: 2 }]
   */
  placements?: Array<{
    participantId: IdString;
    placement: number;
  }>;

  /**
   * Compact scoring summary keyed by participantId.
   * Example: { "p1": 21, "p2": 17 }
   */
  scoresByParticipantId?: Record<IdString, number>;

  /**
   * Engine-defined compact summary for display. Must be JSON.
   * The platform may store and render this but should not depend on its structure.
   */
  scoringSummary?: JSONObject;

  /**
   * Engine-defined flags that help platform decide post-processing (e.g., "forfeit", "timeout").
   * Must remain stable across deterministic re-runs for the same inputs.
   */
  outcomeFlags?: string[];

  /**
   * Engine-defined result payload (opaque JSON).
   * This can be richer than scoringSummary and may include mode-specific details.
   */
  extra?: JSONObject;
}

/**
 * Replay payload: engine-defined but stored and transmitted as opaque JSON.
 * Platform may cap size and validate JSON shape, but must not interpret contents.
 */
export interface MatchReplayV1 {
  /**
   * Engine-defined schema/version label for the replay payload.
   * Example: "boba-replay:v1"
   */
  replayVersion: string;

  /** Opaque replay JSON. */
  payload: JSONValue;
}

/**
 * The complete artifact.
 *
 * Contract:
 * - Tournaments/rewards/sponsors/marketplace reactions read ONLY this artifact.
 * - They do not call game logic.
 */
export interface MatchArtifactV1 {
  header: MatchArtifactHeaderV1;

  participants: MatchParticipantV1[];

  /**
   * The platform supplies a seed; engines must use it if any RNG is involved.
   * Store it here for audit; if you prefer not to expose raw seed, store a seedDigest instead.
   */
  seed: string;

  /** Digest of key sanitized inputs used for the match. */
  inputsDigest: InputsDigestV1;

  /** Standardized timeline (can be empty if engine does not emit events). */
  timeline: MatchTimelineEventV1[];

  /** Minimal standardized result summary. */
  result: MatchResultV1;

  /** Determinism proof binding inputs/seed to outputs. */
  deterministicHash: DeterministicHashV1;

  /** Opaque replay payload for audits/disputes. */
  replay: MatchReplayV1;

  /**
   * Platform-owned envelope for future extensions without breaking the core.
   * Must be JSON.
   */
  platformMeta?: JSONObject;
}
