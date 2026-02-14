/**
 * TournamentEventProducerV1 — Artifact-driven production of tournament.completed event.
 *
 * Phase 10 (event production):
 * - NO engine calls
 * - Consumes TournamentV1 + MatchArtifactV1[]
 * - Uses RoundRobinDeriverV1 (or any TournamentDeriverV1) to build the snapshot payload
 * - Emits TournamentCompletedEventV1 only when completion conditions are met
 *
 * Completion rule (minimal, deterministic):
 * - If tournament.schedule exists and every slot with a matchId has a corresponding artifact,
 *   and matchesCompleted >= matchesPlanned, then tournament is considered completed.
 * - Otherwise, no tournament.completed event is produced.
 *
 * Note:
 * - This is a type-safe producer. Event bus/persistence is out of scope.
 */

import type { IdString, MatchArtifactV1, JSONObject } from "./MatchArtifactV1";
import type { TournamentV1, TournamentDeriverV1 } from "./TournamentV1";
import type {
  TournamentCompletedEventV1,
  TournamentCompletedPayloadV1,
  PlatformEventEnvelopeV1,
} from "./PlatformGameplayEventsV1";

function nowIso(): string {
  return new Date().toISOString();
}

/** Stable-ish event id (not crypto). Platform can replace with ULID/UUID later. */
function makeEventId(tournamentId: IdString, deterministicKey: string): IdString {
  return `EVT_TOURNAMENT_COMPLETED_${tournamentId}_${deterministicKey}`;
}

function sortArtifactsDeterministically(artifacts: MatchArtifactV1[]): MatchArtifactV1[] {
  return artifacts.slice().sort((a, b) => {
    const m = a.header.matchId.localeCompare(b.header.matchId);
    if (m !== 0) return m;
    return a.deterministicHash.value.localeCompare(b.deterministicHash.value);
  });
}

function buildArtifactIndex(artifacts: MatchArtifactV1[]): Array<{ matchId: IdString; deterministicHash: string }> {
  return sortArtifactsDeterministically(artifacts).map((a) => ({
    matchId: a.header.matchId,
    deterministicHash: a.deterministicHash.value,
  }));
}

function isTournamentComplete(tournament: TournamentV1, artifacts: MatchArtifactV1[]): { ok: boolean; key: string } {
  const schedule = tournament.schedule;
  if (!schedule || schedule.length === 0) return { ok: false, key: "no-schedule" };

  const plannedMatchIds = schedule
    .map((s) => s.matchId)
    .filter((x): x is string => typeof x === "string" && x.length > 0);

  if (plannedMatchIds.length === 0) return { ok: false, key: "no-planned-matches" };

  const artifactMatchIds = new Set(artifacts.map((a) => a.header.matchId));

  const missing = plannedMatchIds.filter((mid) => !artifactMatchIds.has(mid));
  if (missing.length > 0) return { ok: false, key: `missing:${missing.sort().join(",")}` };

  // Deterministic key derived from the sorted deterministicHash list.
  const key = buildArtifactIndex(artifacts)
    .map((x) => x.deterministicHash)
    .join("_");

  return { ok: true, key: key || "nohash" };
}

export interface ProduceTournamentCompletedEventParamsV1 {
  tournament: TournamentV1;
  artifacts: MatchArtifactV1[];

  /**
   * Deriver to use for producing snapshot views.
   * For ROUND_ROBIN, pass new RoundRobinDeriverV1().
   */
  deriver: TournamentDeriverV1;

  /**
   * Optional correlation identifiers for tracing.
   */
  correlation?: {
    requestId?: IdString;
    sponsorId?: IdString;
  };

  /**
   * Optional audit references (ids only, no storage assumptions).
   */
  auditRefs?: {
    orchestrationPacketIds?: IdString[];
    determinismVerificationIds?: IdString[];
  };
}

/**
 * Produce a tournament.completed event envelope if the tournament is complete; otherwise null.
 */
export function produceTournamentCompletedEventV1(
  params: ProduceTournamentCompletedEventParamsV1
): TournamentCompletedEventV1 | null {
  const { tournament, artifacts, deriver, correlation, auditRefs } = params;

  // Binding enforcement is handled inside deriver implementations (recommended).
  const completion = isTournamentComplete(tournament, artifacts);
  if (!completion.ok) return null;

  const standings = deriver.deriveStandings({ tournament, artifacts });
  const progress = deriver.deriveProgress({ tournament, artifacts });

  const payload: TournamentCompletedPayloadV1 = {
    tournamentId: tournament.header.tournamentId,
    snapshot: {
      standings,
      progress,
      artifactIndex: buildArtifactIndex(artifacts),
      auditRefs: auditRefs ?? undefined,
    } as unknown as JSONObject,
  };

  const envelope: PlatformEventEnvelopeV1<"tournament.completed", TournamentCompletedPayloadV1> = {
    eventsVersion: "PlatformGameplayEventsV1",
    eventId: makeEventId(tournament.header.tournamentId, completion.key),
    name: "tournament.completed",
    occurredAt: nowIso(),
    correlation: {
      requestId: correlation?.requestId,
      sponsorId: correlation?.sponsorId,
      tournamentId: tournament.header.tournamentId,
      universeCode: tournament.header.universeCode,
      engineCode: tournament.header.engineCode,
      engineVersion: tournament.header.engineVersion,
      modeCode: tournament.header.modeCode,
    },
    payload,
    meta: {
      producer: "TournamentEventProducerV1",
      completionKey: completion.key,
    },
  };

  return envelope as TournamentCompletedEventV1;
}

export default produceTournamentCompletedEventV1;
