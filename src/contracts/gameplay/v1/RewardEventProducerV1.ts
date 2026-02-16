/**
 * RewardEventProducerV1 — Artifact-driven reward intent production (no payouts).
 *
 * Phase 12 Step 2:
 * - Converts MatchArtifactV1 and/or tournament.completed event into RewardEventV1 intents
 * - NO engine calls
 * - NO replay inspection
 * - Deterministic linkage to source deterministicHash
 * - Simple in-file policy map (proof-level, replaceable later)
 *
 * Minimal policy (proof):
 * - From MatchArtifactV1:
 *     winner -> XP_GRANT (code: "XP_MATCH_WIN", xpAmount: 10)
 * - From tournament.completed:
 *     champion -> BADGE_UNLOCK (code: "BADGE_TOURNAMENT_CHAMPION", badgeCode: "TOURNAMENT_CHAMPION")
 *     champion -> XP_GRANT (code: "XP_TOURNAMENT_CHAMPION", xpAmount: 100)
 *
 * Notes:
 * - This is a producer of reward *intents*, not a fulfillment system.
 * - Downstream systems decide issuance, idempotency, and persistence.
 */

import type { MatchArtifactV1, IdString, JSONObject } from "./MatchArtifactV1";
import type { RewardEventV1, RewardKindV1 } from "./RewardEventV1";
import type { TournamentCompletedEventV1 } from "./PlatformGameplayEventsV1";

function nowIso(): string {
  return new Date().toISOString();
}

/** Deterministic-ish rewardEventId (not crypto). */
function makeRewardEventId(parts: string[]): IdString {
  return ("REW_" + parts.join("_")).replace(/[^A-Za-z0-9_\-]/g, "_");
}

function baseFieldsFromBinding(binding: {
  universeCode: string;
  engineCode: string;
  engineVersion: string;
  modeCode: string;
}) {
  return {
    universeCode: binding.universeCode,
    engineCode: binding.engineCode,
    engineVersion: binding.engineVersion,
    modeCode: binding.modeCode,
  };
}

export interface ProduceRewardsFromMatchParamsV1 {
  artifact: MatchArtifactV1;

  /** Optional user lookup already performed elsewhere (not required). */
  userIdByParticipantId?: Record<IdString, IdString>;
}

export function produceRewardEventsFromMatchArtifactV1(
  params: ProduceRewardsFromMatchParamsV1
): RewardEventV1[] {
  const { artifact, userIdByParticipantId } = params;
  const winner = artifact.result.winnerParticipantId;

  if (!winner) return [];

  const issuedAt = nowIso();
  const binding = baseFieldsFromBinding({
    universeCode: artifact.header.universeCode,
    engineCode: artifact.header.engineCode,
    engineVersion: artifact.header.engineVersion,
    modeCode: artifact.header.modeCode,
  });

  const ev: RewardEventV1 = {
    rewardEventVersion: "RewardEventV1",
    rewardEventId: makeRewardEventId([
      "MATCH",
      artifact.header.matchId,
      artifact.deterministicHash.value,
      "XP_MATCH_WIN",
      winner,
    ]),
    issuedAt,
    ...binding,
    source: {
      sourceType: "MATCH",
      sourceId: artifact.header.matchId,
      deterministicHash: artifact.deterministicHash.value,
    },
    recipients: [
      {
        participantId: winner,
        userId: userIdByParticipantId?.[winner],
        placement: 1,
      },
    ],
    payload: {
      kind: "XP_GRANT",
      code: "XP_MATCH_WIN",
      xpAmount: 10,
      extra: { note: "Proof policy: match win XP grant" } as JSONObject,
    },
    meta: { producer: "RewardEventProducerV1" } as JSONObject,
  };

  return [ev];
}

export interface ProduceRewardsFromTournamentCompletedParamsV1 {
  event: TournamentCompletedEventV1;

  /** Optional user lookup already performed elsewhere (not required). */
  userIdByParticipantId?: Record<IdString, IdString>;
}

/**
 * Produce rewards from tournament.completed.
 *
 * Assumes the event payload contains a snapshot with:
 * - progress.view.championParticipantId OR standings.rows[0].participantId
 * - artifactIndex including deterministicHash values
 */
export function produceRewardEventsFromTournamentCompletedV1(
  params: ProduceRewardsFromTournamentCompletedParamsV1
): RewardEventV1[] {
  const { event, userIdByParticipantId } = params;

  const corr = event.correlation;
  const issuedAt = nowIso();

  const binding = baseFieldsFromBinding({
    universeCode: corr.universeCode,
    engineCode: corr.engineCode,
    engineVersion: corr.engineVersion,
    modeCode: corr.modeCode,
  });

  const snapshot: any = (event.payload as any)?.snapshot ?? {};
  const progress: any = snapshot?.progress ?? {};
  const standings: any = snapshot?.standings ?? {};
  const artifactIndex: any[] = snapshot?.artifactIndex ?? [];

  const championFromProgress: string | undefined = progress?.view?.championParticipantId;
  const championFromStandings: string | undefined = standings?.rows?.[0]?.participantId;

  const champion = (championFromProgress || championFromStandings) as IdString | undefined;
  if (!champion) return [];

  // Deterministic key for the tournament: join artifact hashes (already deterministic order in producer).
  const deterministicKey = artifactIndex.map((x) => x.deterministicHash).join("_") || "nohash";

  const out: RewardEventV1[] = [];

  // 1) Badge unlock
  out.push({
    rewardEventVersion: "RewardEventV1",
    rewardEventId: makeRewardEventId([
      "TOURNAMENT",
      corr.tournamentId,
      deterministicKey,
      "BADGE_TOURNAMENT_CHAMPION",
      champion,
    ]),
    issuedAt,
    ...binding,
    source: {
      sourceType: "TOURNAMENT",
      sourceId: corr.tournamentId,
      deterministicHash: deterministicKey,
    },
    recipients: [
      {
        participantId: champion,
        userId: userIdByParticipantId?.[champion],
        placement: 1,
      },
    ],
    payload: {
      kind: "BADGE_UNLOCK",
      code: "BADGE_TOURNAMENT_CHAMPION",
      badgeCode: "TOURNAMENT_CHAMPION",
      extra: { note: "Proof policy: tournament champion badge" } as JSONObject,
    },
    meta: { producer: "RewardEventProducerV1" } as JSONObject,
  });

  // 2) XP grant
  out.push({
    rewardEventVersion: "RewardEventV1",
    rewardEventId: makeRewardEventId([
      "TOURNAMENT",
      corr.tournamentId,
      deterministicKey,
      "XP_TOURNAMENT_CHAMPION",
      champion,
    ]),
    issuedAt,
    ...binding,
    source: {
      sourceType: "TOURNAMENT",
      sourceId: corr.tournamentId,
      deterministicHash: deterministicKey,
    },
    recipients: [
      {
        participantId: champion,
        userId: userIdByParticipantId?.[champion],
        placement: 1,
      },
    ],
    payload: {
      kind: "XP_GRANT",
      code: "XP_TOURNAMENT_CHAMPION",
      xpAmount: 100,
      extra: { note: "Proof policy: tournament champion XP" } as JSONObject,
    },
    meta: { producer: "RewardEventProducerV1" } as JSONObject,
  });

  return out;
}

/**
 * Convenience: produce rewards from either a match artifact or tournament.completed.
 * Caller chooses source.
 */
export function produceRewardEventsV1(params: {
  source:
    | { kind: "MATCH"; artifact: MatchArtifactV1 }
    | { kind: "TOURNAMENT_COMPLETED"; event: TournamentCompletedEventV1 };
  userIdByParticipantId?: Record<IdString, IdString>;
}): RewardEventV1[] {
  if (params.source.kind === "MATCH") {
    return produceRewardEventsFromMatchArtifactV1({
      artifact: params.source.artifact,
      userIdByParticipantId: params.userIdByParticipantId,
    });
  }

  return produceRewardEventsFromTournamentCompletedV1({
    event: params.source.event,
    userIdByParticipantId: params.userIdByParticipantId,
  });
}

export default produceRewardEventsV1;
