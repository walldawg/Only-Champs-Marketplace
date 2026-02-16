// src/contracts/gameplay/v1/BoBAEngineAdapterV1.ts
/**
 * BoBAEngineAdapterV1 — Stub adapter for BoBA Core Engine (Phase 15 Step 2).
 *
 * Milestone B:
 * - B2: consume standardized timeline if provided in outputs.timeline
 * - B3: emit standardized timeline in runMatch outputs (so produceArtifact can pass it through)
 *
 * Determinism:
 * - No wall-clock timestamps. Header + timeline 'at' values are deterministic from {seed, matchId}.
 *
 * Non-goals:
 * - Real BoBA gameplay
 * - DB calls / Prisma types
 */

import {
  MATCH_ARTIFACT_VERSION,
  type MatchArtifactV1,
  type IdString,
  type JSONObject,
  type MatchTimelineEventV1,
} from "./MatchArtifactV1";

import type {
  EngineAdapterV1,
  ValidateDeckInputV1,
  CreateMatchInputV1,
  RunMatchInputV1,
  ProduceArtifactInputV1,
  DeckValidationResultV1,
  MatchInitV1,
  RunMatchResultV1,
} from "./EngineAdapterV1";

import { BoBAEngineManifestV1, BOBA_ENGINE_CODE, BOBA_ENGINE_VERSION } from "./BoBAEngineManifestV1";

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
  const parts = keys.map((k) => JSON.stringify(k) + ":" + stableStringify((value as any)[k]));
  return "{" + parts.join(",") + "}";
}

/**
 * Non-cryptographic djb2 hash (32-bit) as hex string, stable across runs.
 */
function djb2Hex(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
    hash |= 0;
  }
  const u = hash >>> 0;
  return u.toString(16).padStart(8, "0");
}

/**
 * Deterministic ISO timestamp helper.
 * (Never use wall-clock in adapter outputs.)
 */
function deterministicIso(seed: string, matchId: string, idx: number): string {
  const h = djb2Hex(`${seed}::${matchId}`);
  const n = parseInt(h, 16) >>> 0;

  const baseEpochMs = 1700000000000; // fixed constant
  const offsetMs = (n % 86_400_000) >>> 0; // within 24h
  const t = baseEpochMs + offsetMs + idx * 1000; // 1s spacing
  return new Date(t).toISOString();
}

function digestInputsNonCrypto(inputs: JSONObject): string {
  const stable = stableStringify(inputs);
  return djb2Hex(stable);
}

function deterministicBundleHash(params: {
  seed: string;
  participantIdsSorted: string[];
  inputsDigest: string;
  result: {
    winnerParticipantId?: string;
    scoresByParticipantId?: Record<string, number>;
    outcomeFlags?: string[];
  };
  timeline?: MatchTimelineEventV1[];
}): string {
  const stable = stableStringify({
    seed: params.seed,
    participants: params.participantIdsSorted,
    inputsDigest: params.inputsDigest,
    result: params.result,
    timeline: params.timeline ?? null,
  });
  return djb2Hex(stable);
}

function isTimelineEventLike(v: any): v is MatchTimelineEventV1 {
  return (
    v &&
    typeof v === "object" &&
    typeof v.idx === "number" &&
    typeof v.code === "string" &&
    typeof v.at === "string"
  );
}

/**
 * If a timeline is present in outputs, sanitize it to the contract surface:
 * - Ensure idx is monotonic 0..n-1 (platform invariant)
 * - Keep only stable top-level fields (extra is allowed if JSON)
 */
function coerceTimelineFromOutputs(outputs: JSONObject | undefined): MatchTimelineEventV1[] | null {
  if (!outputs) return null;

  const raw = (outputs as any).timeline;
  if (!Array.isArray(raw)) return null;

  const filtered = raw.filter(isTimelineEventLike);
  if (filtered.length === 0) return null;

  // Re-index to 0..n-1 in current order.
  return filtered.map((e, i) => ({
    idx: i,
    code: e.code,
    at: e.at,
    participantId: e.participantId,
    metrics: e.metrics,
    extra: e.extra,
  }));
}

export class BoBAEngineAdapterV1 implements EngineAdapterV1 {
  public readonly adapterVersion = "EngineAdapterV1" as const;

  // Optional: expose manifest for callers
  public readonly manifest = BoBAEngineManifestV1;

  async validateDeck(params: ValidateDeckInputV1): Promise<DeckValidationResultV1> {
    // Stub policy: always ok. Real BoBA rules come later.
    return {
      ok: true,
      warnings: [],
      extra: { validatedBy: "boba-stub", modeCode: params.modeCode } as JSONObject,
    };
  }

  async createMatch(params: CreateMatchInputV1): Promise<MatchInitV1> {
    const createdAt = deterministicIso(params.seed, params.matchId, 0);
    const participantIds = params.participants.map((p) => p.participantId);

    return {
      ok: true,
      state: {
        createdAt,
        matchId: params.matchId,
        seed: params.seed,
        participants: participantIds,
        inputsHashHint: digestInputsNonCrypto(params.inputs).slice(0, 8),
      },
      extra: { createdBy: "boba-stub" } as JSONObject,
    };
  }

  async runMatch(params: RunMatchInputV1): Promise<RunMatchResultV1> {
    // Stub gameplay: deterministic winner based on seed hash.
    const ids = ((params.state as any)?.participants ?? []).slice().sort();
    if (!ids.length) {
      return { ok: false, errors: [{ code: "BAD_STATE", message: "Missing participants in state" }] };
    }

    const seedHash = djb2Hex(params.seed);
    const pick = parseInt(seedHash.slice(-1), 16) % ids.length;

    const winnerParticipantId = ids[pick] as IdString;
    const scoresByParticipantId: Record<string, number> = {};
    for (const id of ids) scoresByParticipantId[id] = id === winnerParticipantId ? 1 : 0;

    // B3: emit a standardized timeline in outputs so produceArtifact can pass it through.
    const startedAt = deterministicIso(params.seed, params.matchId, 0);
    const completedAt = deterministicIso(params.seed, params.matchId, 1);

    const timeline: MatchTimelineEventV1[] = [
      {
        idx: 0,
        code: "MATCH_START",
        at: startedAt,
        metrics: {},
        extra: { note: "boba stub start (runMatch)" } as JSONObject,
      },
      {
        idx: 1,
        code: "MATCH_END",
        at: completedAt,
        participantId: winnerParticipantId,
        metrics: { winnerScore: 1 },
        extra: { note: "boba stub end (runMatch)" } as JSONObject,
      },
    ];

    return {
      ok: true,
      outputs: {
        winnerParticipantId,
        scoresByParticipantId,
        outcomeFlags: [] as string[],
        timeline,
      } as JSONObject,
      extra: { ranBy: "boba-stub" } as JSONObject,
    };
  }

  async produceArtifact(params: ProduceArtifactInputV1): Promise<MatchArtifactV1> {
    const engineCode = BOBA_ENGINE_CODE;
    const engineVersion = BOBA_ENGINE_VERSION;

    const inputsDigestValue = digestInputsNonCrypto(params.inputs);

    const participantIdsSorted = params.participants
      .map((p) => p.participantId)
      .slice()
      .sort();

    const winner = (params.outputs as any).winnerParticipantId as string | undefined;

    // B2: prefer engine-provided timeline if present.
    const engineTimeline = coerceTimelineFromOutputs(params.outputs);

    // Deterministic timestamps for header:
    // - If engine timeline present, use its first/last 'at'
    // - Else derive deterministically from {seed, matchId}
    const startedAt = engineTimeline?.[0]?.at ?? deterministicIso(params.seed, params.matchId, 0);
    const completedAt = engineTimeline?.[engineTimeline.length - 1]?.at ?? deterministicIso(params.seed, params.matchId, 1);

    const deterministicHashValue = deterministicBundleHash({
      seed: params.seed,
      participantIdsSorted,
      inputsDigest: inputsDigestValue,
      result: {
        winnerParticipantId: winner,
        scoresByParticipantId: (params.outputs as any).scoresByParticipantId,
        outcomeFlags: (params.outputs as any).outcomeFlags,
      },
      timeline: engineTimeline ?? undefined,
    });

    const fallbackTimeline: MatchTimelineEventV1[] = [
      {
        idx: 0,
        code: "MATCH_START",
        at: startedAt,
        metrics: {},
        extra: { note: "boba stub start (fallback)" } as JSONObject,
      },
      {
        idx: 1,
        code: "MATCH_END",
        at: completedAt,
        participantId: winner,
        metrics: { winnerScore: winner ? 1 : 0 },
        extra: { note: "boba stub end (fallback)" } as JSONObject,
      },
    ];

    const artifact: MatchArtifactV1 = {
      header: {
        artifactVersion: MATCH_ARTIFACT_VERSION,
        universeCode: params.universeCode,
        engineCode,
        engineVersion,
        modeCode: params.modeCode,
        matchId: params.matchId,
        startedAt,
        completedAt,
      },
      participants: params.participants.map((p) => ({
        participantId: p.participantId,
        role: (p as any).role ?? "PLAYER",
        extra: (p.extra ?? {}) as JSONObject,
      })),
      seed: params.seed,
      inputsDigest: {
        algo: "noncrypto-djb2:stable-json-sortedkeys:v1",
        value: inputsDigestValue,
      },
      timeline: engineTimeline ?? fallbackTimeline,
      result: {
        winnerParticipantId: winner,
        placements: participantIdsSorted.map((pid, i) => ({
          participantId: pid as IdString,
          placement: pid === winner ? 1 : 2 + i,
        })),
        scoresByParticipantId: (params.outputs as any).scoresByParticipantId,
        outcomeFlags: (params.outputs as any).outcomeFlags,
        scoringSummary: {
          kind: "boba-stub",
          scoresByParticipantId: (params.outputs as any).scoresByParticipantId,
        } as JSONObject,
      },
      deterministicHash: {
        algo: "noncrypto-djb2:inputsDigest+result+timeline:v1",
        value: deterministicHashValue,
      },
      replay: {
        replayVersion: "boba-stub-replay:v1",
        payload: {
          seed: params.seed,
          participants: participantIdsSorted,
          inputsDigest: inputsDigestValue,
          deterministicHash: deterministicHashValue,
          timelineCount: (engineTimeline ?? fallbackTimeline).length,
        } as JSONObject,
      },
      platformMeta: {
        producedBy: "BoBAEngineAdapterV1",
        note: "B3: runMatch emits timeline; produceArtifact passes through when provided.",
      } as JSONObject,
    };

    return artifact;
  }
}

export default BoBAEngineAdapterV1;
