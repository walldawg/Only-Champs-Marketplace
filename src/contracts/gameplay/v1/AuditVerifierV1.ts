/**
 * AuditVerifierV1 — Deterministic hash verification for MatchArtifactV1 (no engine calls).
 *
 * Phase 13 Step 2:
 * - Recomputes deterministicHash from the artifact content (bundle hash)
 * - Compares against artifact.deterministicHash.value
 * - Produces an AuditRecordV1
 *
 * Constraints:
 * - NO engine calls
 * - NO replay inspection
 * - Uses the same noncrypto-djb2 hashing approach as Phase 9 spine (stable-json-sortedkeys bundle).
 */

import type { MatchArtifactV1, IdString, JSONObject } from "./MatchArtifactV1";
import type { AuditRecordV1, AuditStatusV1 } from "./AuditRecordV1";

function nowIso(): string {
  return new Date().toISOString();
}

function makeAuditId(matchId: IdString, expected: string): IdString {
  return `AUDIT_${matchId}_${expected}`.replace(/[^A-Za-z0-9_\-]/g, "_");
}

/**
 * Stable JSON stringify with sorted keys (recursively).
 * Arrays preserve order.
 */
function stableStringify(value: any): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== "object") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return "[" + value.map((v) => stableStringify(v)).join(",") + "]";
  }

  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k]));
  return "{" + parts.join(",") + "}";
}

/**
 * Non-cryptographic djb2 hash (32-bit) as hex string, stable across runs.
 * Matches Phase 9 intent: "noncrypto-djb2:bundle:v1".
 */
function djb2Hex(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
    hash |= 0; // force 32-bit
  }
  // Convert to unsigned and hex, pad to 8
  const u = hash >>> 0;
  return u.toString(16).padStart(8, "0");
}

/**
 * Build the deterministic bundle payload for hashing.
 * IMPORTANT: Excludes platformMeta (non-deterministic) by design.
 * Includes header, participants, seed, inputsDigest, timeline, result, replay.
 */
function buildDeterministicBundle(artifact: MatchArtifactV1): JSONObject {
  const participantIdsSorted = artifact.participants
    .map((p) => p.participantId)
    .slice()
    .sort();

  return {
    seed: artifact.seed,
    participants: participantIdsSorted,
    inputsDigest: artifact.inputsDigest.value,
    result: {
      winnerParticipantId: artifact.result.winnerParticipantId,
      scoresByParticipantId: artifact.result.scoresByParticipantId,
      outcomeFlags: artifact.result.outcomeFlags,
    },
  } as unknown as JSONObject;
}

export interface VerifyMatchArtifactParamsV1 {
  artifact: MatchArtifactV1;
}

/**
 * Verify a MatchArtifactV1 deterministic hash.
 */
export function verifyMatchArtifactDeterminismV1(
  params: VerifyMatchArtifactParamsV1
): AuditRecordV1 {
  const { artifact } = params;

  const expected = artifact.deterministicHash.value;

  try {
    const bundle = buildDeterministicBundle(artifact);
    const stableJson = stableStringify(bundle);
    const recomputed = djb2Hex(stableJson);

    const matches = recomputed === expected;

    const status: AuditStatusV1 = matches ? "VERIFIED" : "HASH_MISMATCH";

    const record: AuditRecordV1 = {
      auditRecordVersion: "AuditRecordV1",
      auditRecordId: makeAuditId(artifact.header.matchId, expected),
      auditedAt: nowIso(),
      universeCode: artifact.header.universeCode,
      engineCode: artifact.header.engineCode,
      engineVersion: artifact.header.engineVersion,
      modeCode: artifact.header.modeCode,
      source: {
        sourceType: "MATCH",
        sourceId: artifact.header.matchId,
        expectedDeterministicHash: expected,
      },
      status,
      comparison: {
        recomputedDeterministicHash: recomputed,
        matchesExpected: matches,
        extra: {
          algo: "noncrypto-djb2:stable-json-sortedkeys:inputsDigest+result:v1",
        } as JSONObject,
      },
      meta: {
        producer: "AuditVerifierV1",
      } as JSONObject,
    };

    return record;
  } catch (err: any) {
    const record: AuditRecordV1 = {
      auditRecordVersion: "AuditRecordV1",
      auditRecordId: makeAuditId(artifact.header.matchId, expected),
      auditedAt: nowIso(),
      universeCode: artifact.header.universeCode,
      engineCode: artifact.header.engineCode,
      engineVersion: artifact.header.engineVersion,
      modeCode: artifact.header.modeCode,
      source: {
        sourceType: "MATCH",
        sourceId: artifact.header.matchId,
        expectedDeterministicHash: expected,
      },
      status: "ERROR",
      comparison: {
        matchesExpected: false,
        extra: {
          message: String(err?.message ?? err),
        } as JSONObject,
      },
      meta: {
        producer: "AuditVerifierV1",
      } as JSONObject,
    };

    return record;
  }
}

export default verifyMatchArtifactDeterminismV1;
