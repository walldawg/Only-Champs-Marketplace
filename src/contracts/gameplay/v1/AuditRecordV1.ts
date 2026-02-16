/**
 * AuditRecordV1 — Deterministic verification & dispute contract.
 *
 * Phase 13 Step 1 (types only):
 * - Verifies MatchArtifactV1 or Tournament completion integrity
 * - Allows re-run comparison against deterministicHash
 * - Engine-agnostic
 * - No Prisma types
 *
 * Purpose:
 * - Enable audit, replay validation, and dispute workflows
 * - Provide immutable verification record
 */

import type { IdString, JSONObject } from "./MatchArtifactV1";

export const AUDIT_RECORD_VERSION = "AuditRecordV1" as const;

export type AuditSourceTypeV1 = "MATCH" | "TOURNAMENT";

export type AuditStatusV1 =
  | "VERIFIED"
  | "HASH_MISMATCH"
  | "REPLAY_MISMATCH"
  | "SOURCE_NOT_FOUND"
  | "ERROR";

export interface AuditSourceRefV1 {
  sourceType: AuditSourceTypeV1;
  sourceId: IdString;
  expectedDeterministicHash: string;
}

export interface AuditComparisonV1 {
  recomputedDeterministicHash?: string;
  replayDeterministicHash?: string;
  matchesExpected: boolean;
  extra?: JSONObject;
}

export interface AuditRecordV1 {
  auditRecordVersion: typeof AUDIT_RECORD_VERSION;

  auditRecordId: IdString;
  auditedAt: string;

  universeCode: string;
  engineCode: string;
  engineVersion: string;
  modeCode: string;

  source: AuditSourceRefV1;

  status: AuditStatusV1;

  comparison?: AuditComparisonV1;

  meta?: JSONObject;
}
