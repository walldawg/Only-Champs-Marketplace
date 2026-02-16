/**
 * PlatformGameplayEventsV1 — Artifact-driven event shapes (type-only).
 *
 * Phase 9 Implementation Step 8:
 * - Define canonical event names + payload envelopes for platform hooks.
 * - No event bus implementation, no persistence, no handlers.
 *
 * Purpose:
 * - Marketplace/tournaments/rewards/sponsors attach to these events WITHOUT calling engines.
 * - Payloads are JSON-safe and primarily reference MatchArtifactV1.
 */

import type { IdString, JSONObject, MatchArtifactV1 } from "./MatchArtifactV1";

export const PLATFORM_GAMEPLAY_EVENTS_VERSION = "PlatformGameplayEventsV1" as const;

/** Canonical event names for gameplay lifecycle (Phase 9). */
export type PlatformGameplayEventNameV1 =
  | "match.completed"          // artifact produced
  | "match.failed"             // orchestration failed (no artifact)
  | "tournament.round.completed" // derived from artifacts (Phase 10+)
  | "tournament.completed"     // derived from artifacts (Phase 10+)
  | "rewards.issued";          // platform action (Phase 12+)

/**
 * Base event envelope.
 * - id is platform-minted for idempotency
 * - occurredAt is platform time
 */
export interface PlatformEventEnvelopeV1<TName extends PlatformGameplayEventNameV1, TPayload> {
  eventsVersion: typeof PLATFORM_GAMEPLAY_EVENTS_VERSION;

  /** Platform event id (UUID/ULID/etc.). */
  eventId: IdString;

  /** Event name. */
  name: TName;

  /** ISO-8601 timestamp (platform time). */
  occurredAt: string;

  /**
   * Optional correlation identifiers for tracing across systems.
   * Example: requestId, tournamentId, sponsorId.
   */
  correlation?: {
    requestId?: IdString;
    tournamentId?: IdString;
    sponsorId?: IdString;
    universeCode?: string;
    engineCode?: string;
    engineVersion?: string;
    modeCode?: string;
    matchId?: IdString;
  };

  /** Event payload (JSON-safe). */
  payload: TPayload;

  /** Optional platform metadata (JSON). */
  meta?: JSONObject;
}

/** Payload when a match completes successfully (artifact produced). */
export interface MatchCompletedPayloadV1 {
  artifact: MatchArtifactV1;

  /**
   * Optional lightweight references to stored orchestration/audit records.
   * No storage assumptions: just ids.
   */
  auditRefs?: {
    orchestrationPacketId?: IdString;
    determinismVerificationId?: IdString;
  };
}

/** Payload when a match fails before producing an artifact. */
export interface MatchFailedPayloadV1 {
  universeCode: string;
  engineCode: string;
  engineVersion: string;
  modeCode: string;
  matchId: IdString;

  /** Stable failure code. */
  failureCode: string;

  /** Human message. */
  message: string;

  /** Optional structured details (JSON). */
  details?: JSONObject;
}

/** Event: match.completed */
export type MatchCompletedEventV1 = PlatformEventEnvelopeV1<"match.completed", MatchCompletedPayloadV1>;

/** Event: match.failed */
export type MatchFailedEventV1 = PlatformEventEnvelopeV1<"match.failed", MatchFailedPayloadV1>;

/**
 * Placeholder payloads for Phase 10+ derived events.
 * Defined now to avoid renaming later; detailed shapes can extend these types.
 */
export interface TournamentRoundCompletedPayloadV1 {
  tournamentId: IdString;
  round: number;
  /** Derived state snapshot (JSON). */
  snapshot?: JSONObject;
}

export interface TournamentCompletedPayloadV1 {
  tournamentId: IdString;
  /** Final standings/bracket snapshot (JSON). */
  snapshot?: JSONObject;
}

export interface RewardsIssuedPayloadV1 {
  /** The event that triggered reward issuance (match or tournament). */
  triggerEventId: IdString;

  /** Reward batch id. */
  rewardBatchId: IdString;

  /** Optional summary (JSON). */
  summary?: JSONObject;
}

export type TournamentRoundCompletedEventV1 = PlatformEventEnvelopeV1<
  "tournament.round.completed",
  TournamentRoundCompletedPayloadV1
>;

export type TournamentCompletedEventV1 = PlatformEventEnvelopeV1<
  "tournament.completed",
  TournamentCompletedPayloadV1
>;

export type RewardsIssuedEventV1 = PlatformEventEnvelopeV1<"rewards.issued", RewardsIssuedPayloadV1>;
