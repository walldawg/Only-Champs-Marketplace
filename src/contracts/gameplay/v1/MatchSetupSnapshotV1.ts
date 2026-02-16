/**
 * MatchSetupSnapshotV1 — Frozen setup snapshot captured at the moment a match/session enters SETUP.
 *
 * Milestone F — Ticket F5
 *
 * Purpose:
 * - Freeze the universe boundary into the match lifecycle
 * - Prevent mid-session universe/engine/mode switching
 * - Provide a stable reference for replay, audit, and operator review
 *
 * Scope:
 * - Types + minimal constructor helper only
 * - No DB, no routes, no enforcement wiring
 */

import type { IdString, JSONObject } from "./MatchArtifactV1";

export const MATCH_SETUP_SNAPSHOT_VERSION = "MatchSetupSnapshotV1" as const;

/**
 * Fields that MUST be immutable after SETUP begins.
 */
export interface MatchSetupSnapshotV1 {
  snapshotVersion: typeof MATCH_SETUP_SNAPSHOT_VERSION;

  /** Snapshot identity (platform). */
  snapshotId: IdString;

  /** When the snapshot was captured. */
  capturedAt: string;

  /** Match identity. */
  matchId: IdString;

  /** Universe boundary (frozen). */
  universeCode: string;
  universeIntegrationId: IdString;

  /** Engine boundary (frozen). */
  engineCode: string;
  engineVersion: string;

  /** Mode boundary (frozen). */
  modeCode: string;

  /** Optional: deck binding (platform asset). */
  deckId?: IdString;

  /**
   * Optional: deck tags observed at setup time.
   * (Used to prove acceptance gates were satisfied when the session was created.)
   */
  deckTags?: string[];

  /**
   * Optional: event/tournament binding if the match was created under an Event authority window.
   * These are identifiers only — no authority semantics in this type.
   */
  eventId?: IdString;
  tournamentId?: IdString;

  /** Optional extra metadata. */
  extra?: JSONObject;
}

export interface CreateMatchSetupSnapshotParamsV1 {
  snapshotId: IdString;
  matchId: IdString;

  universeCode: string;
  universeIntegrationId: IdString;

  engineCode: string;
  engineVersion: string;

  modeCode: string;

  deckId?: IdString;
  deckTags?: string[];

  eventId?: IdString;
  tournamentId?: IdString;

  extra?: JSONObject;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Minimal constructor helper (pure data packaging).
 */
export function createMatchSetupSnapshotV1(
  params: CreateMatchSetupSnapshotParamsV1
): MatchSetupSnapshotV1 {
  return {
    snapshotVersion: MATCH_SETUP_SNAPSHOT_VERSION,
    snapshotId: params.snapshotId,
    capturedAt: nowIso(),
    matchId: params.matchId,

    universeCode: params.universeCode,
    universeIntegrationId: params.universeIntegrationId,

    engineCode: params.engineCode,
    engineVersion: params.engineVersion,

    modeCode: params.modeCode,

    deckId: params.deckId,
    deckTags: params.deckTags,

    eventId: params.eventId,
    tournamentId: params.tournamentId,

    extra: params.extra,
  };
}

export default MatchSetupSnapshotV1;
