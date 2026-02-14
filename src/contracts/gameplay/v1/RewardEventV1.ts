/**
 * RewardEventV1 — Artifact-driven reward issuance contract.
 *
 * Phase 12 Step 1 (types only):
 * - Triggered by match.completed or tournament.completed
 * - Engine-agnostic
 * - No Prisma types
 * - No payout logic
 *
 * Purpose:
 * - Convert gameplay completion events into reward intents
 * - Allow sponsors / marketplace / badge systems to subscribe
 * - Deterministic linkage to source artifact hash
 */

import type { IdString, JSONObject } from "./MatchArtifactV1";

export const REWARD_EVENT_VERSION = "RewardEventV1" as const;

export type RewardSourceTypeV1 = "MATCH" | "TOURNAMENT";

export type RewardKindV1 =
  | "BADGE_UNLOCK"
  | "SPONSOR_PAYOUT"
  | "XP_GRANT"
  | "ITEM_GRANT"
  | "ACHIEVEMENT_UNLOCK"
  | "CUSTOM";

export interface RewardSourceRefV1 {
  sourceType: RewardSourceTypeV1;
  sourceId: IdString;
  deterministicHash: string; // from artifact or tournament completion event
}

export interface RewardRecipientV1 {
  participantId: IdString;
  userId?: IdString;
  placement?: number;
  extra?: JSONObject;
}

export interface RewardPayloadV1 {
  kind: RewardKindV1;
  code: string; // reward program code
  amount?: number;
  currency?: string;
  badgeCode?: string;
  itemCode?: string;
  xpAmount?: number;
  sponsorId?: IdString;
  extra?: JSONObject;
}

export interface RewardEventV1 {
  rewardEventVersion: typeof REWARD_EVENT_VERSION;

  rewardEventId: IdString;
  issuedAt: string;

  universeCode: string;
  engineCode: string;
  engineVersion: string;
  modeCode: string;

  source: RewardSourceRefV1;

  recipients: RewardRecipientV1[];

  payload: RewardPayloadV1;

  meta?: JSONObject;
}
