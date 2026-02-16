/**
 * TournamentV1 — Engine-agnostic tournament shapes (artifact-driven).
 *
 * Phase 10 Step 1 (types only):
 * - Tournament objects reference universeCode + engineCode + engineVersion + modeCode
 * - Progression/standings read ONLY MatchArtifactV1 (no engine calls)
 * - No DB schema, no bracket algorithms, no persistence implementation
 */

import type { IdString, JSONObject, MatchArtifactV1 } from "./MatchArtifactV1";

export const TOURNAMENT_VERSION = "TournamentV1" as const;

/** Tournament status lifecycle (platform-owned). */
export type TournamentStatusV1 = "DRAFT" | "ACTIVE" | "COMPLETED" | "CANCELLED";

/** How the tournament is structured (minimal for Phase 10 Step 1). */
export type TournamentStructureV1 = "ROUND_ROBIN" | "SINGLE_ELIMINATION" | "SWISS";

/**
 * Tournament identity and binding.
 * IMPORTANT: engineVersion is locked so tournaments remain stable.
 */
export interface TournamentHeaderV1 {
  tournamentVersion: typeof TOURNAMENT_VERSION;

  tournamentId: IdString;

  name: string;

  /** ISO-8601 created timestamp (platform time). */
  createdAt: string;

  /** ISO-8601 updated timestamp (platform time). */
  updatedAt: string;

  status: TournamentStatusV1;

  /** Universe + engine binding (locked). */
  universeCode: string;
  engineCode: string;
  engineVersion: string;
  modeCode: string;

  /** Tournament structure. */
  structure: TournamentStructureV1;

  /** Optional organizer/admin metadata (JSON). */
  meta?: JSONObject;
}

/** A tournament participant (player or team). */
export interface TournamentParticipantV1 {
  participantId: IdString;
  label?: string;
  extra?: JSONObject;
}

/**
 * A match slot in the tournament schedule.
 * This is the platform-owned plan, independent from engine.
 */
export interface TournamentMatchSlotV1 {
  slotId: IdString;

  /** Round number (1-based). */
  round: number;

  /** Optional bracket position or table assignment. */
  position?: string;

  /** Participants expected for the match (order may matter per mode; platform decides canonicalization). */
  participantIds: IdString[];

  /**
   * Platform match id if created.
   * This is how the slot links to produced MatchArtifactV1.
   */
  matchId?: IdString;

  /** If set, indicates slot is concluded by this artifact (match.completed). */
  artifactRef?: {
    matchId: IdString;
    deterministicHash?: string;
  };

  /** Optional slot metadata (JSON). */
  extra?: JSONObject;
}

/**
 * Tournament object (types only).
 * Schedule is optional: some structures (Swiss) may evolve round-by-round.
 */
export interface TournamentV1 {
  header: TournamentHeaderV1;

  participants: TournamentParticipantV1[];

  /**
   * Planned match slots (optional).
   * For Swiss, the platform may append slots per round.
   */
  schedule?: TournamentMatchSlotV1[];

  /**
   * References to artifacts included in the tournament record.
   * Platform may store artifacts separately; this list is the "receipt set".
   */
  artifactIndex: Array<{
    matchId: IdString;
    deterministicHash: string;
  }>;

  /** Optional tournament-level notes (JSON). */
  extra?: JSONObject;
}

/**
 * Standings are derived ONLY from MatchArtifactV1.
 * This type describes the output of that derivation.
 */
export interface TournamentStandingsRowV1 {
  participantId: IdString;
  label?: string;

  /** Core scoring measures (platform-defined). */
  wins: number;
  losses: number;
  ties: number;

  /** Points or score accumulation (platform-defined). */
  points: number;

  /**
   * Optional tie-breakers (platform-defined) e.g., "opponentWinPct", "scoreDiff".
   * Numeric only to keep comparisons simple.
   */
  tieBreakers?: Record<string, number>;

  /** Optional derived metadata for display (JSON). */
  extra?: JSONObject;
}

/** Standings table derived from a set of artifacts. */
export interface TournamentStandingsTableV1 {
  tournamentId: IdString;

  /** ISO-8601 derived timestamp (platform time). */
  derivedAt: string;

  /** The artifacts used for derivation (audit). */
  sourceArtifacts: Array<{
    matchId: IdString;
    deterministicHash: string;
  }>;

  rows: TournamentStandingsRowV1[];

  /** Optional summary fields (JSON). */
  summary?: JSONObject;
}

/**
 * Minimal bracket/round state snapshot (structure-agnostic).
 * Detailed bracket models come later; Phase 10 Step 1 is shape-only.
 */
export interface TournamentProgressSnapshotV1 {
  tournamentId: IdString;
  derivedAt: string;

  status: TournamentStatusV1;

  /** Current round (if applicable). */
  currentRound?: number;

  /** Matches completed count. */
  matchesCompleted: number;

  /** Total planned matches if schedule exists. */
  matchesPlanned?: number;

  /** Optional bracket/round view model (JSON). */
  view?: JSONObject;
}

/**
 * Tournament derivation contract (type-only).
 * Implementations must NOT call engines — only consume MatchArtifactV1.
 */
export interface TournamentDeriverV1 {
  /**
   * Derive standings from a set of match artifacts.
   * Platform decides scoring rules per tournament/structure in later steps.
   */
  deriveStandings(params: {
    tournament: TournamentV1;
    artifacts: MatchArtifactV1[];
  }): TournamentStandingsTableV1;

  /**
   * Derive a progress snapshot (round state, completion).
   */
  deriveProgress(params: {
    tournament: TournamentV1;
    artifacts: MatchArtifactV1[];
  }): TournamentProgressSnapshotV1;
}
