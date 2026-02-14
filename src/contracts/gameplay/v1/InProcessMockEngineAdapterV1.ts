/**
 * InProcessMockEngineAdapterV1 — Minimal deterministic in-process adapter stub.
 *
 * Purpose (Phase 9 Step 10):
 * - Prove the contract spine compiles and can flow end-to-end without game logic.
 * - Deterministically selects a winner based on {seed + participants}.
 * - Produces a valid MatchArtifactV1 with minimal timeline + replay.
 *
 * Non-goals:
 * - Cryptographic hashing (this uses a simple non-crypto hash).
 * - Real gameplay logic.
 */

import type {
  EngineAdapterV1,
  DeckValidationResultV1,
  MatchInitV1,
  RunMatchResultV1,
  ValidateDeckInputV1,
  CreateMatchInputV1,
  RunMatchInputV1,
  ProduceArtifactInputV1,
} from "./EngineAdapterV1";
import { MATCH_ARTIFACT_VERSION } from "./MatchArtifactV1";
import type { MatchArtifactV1, JSONObject } from "./MatchArtifactV1";

/** Simple non-crypto string hash (djb2). Deterministic across runtimes. */
function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i); // hash*33 XOR c
    hash = hash >>> 0; // force uint32
  }
  // hex, fixed width
  return hash.toString(16).padStart(8, "0");
}

/** Stable stringify with sorted object keys. (Arrays preserved in given order.) */
function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const sorter = (v: any): any => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(sorter);
    if (seen.has(v)) throw new Error("stableStringify: circular reference");
    seen.add(v);

    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) {
      out[k] = sorter(v[k]);
    }
    return out;
  };

  return JSON.stringify(sorter(value));
}

function nowIso(): string {
  return new Date().toISOString();
}

function canonicalParticipantIds(participants: Array<{ participantId: string }>): string[] {
  return participants.map((p) => p.participantId).slice().sort();
}

function pickWinnerDeterministically(seed: string, participantIdsSorted: string[]): string | undefined {
  if (participantIdsSorted.length === 0) return undefined;
  const basis = seed + "|" + participantIdsSorted.join(",");
  const h = djb2(basis);
  const n = parseInt(h, 16) >>> 0;
  const idx = n % participantIdsSorted.length;
  return participantIdsSorted[idx];
}

export class InProcessMockEngineAdapterV1 implements EngineAdapterV1 {
  readonly adapterVersion = "EngineAdapterV1" as const;

  async validateDeck(input: ValidateDeckInputV1): Promise<DeckValidationResultV1> {
    // Minimal: ensure at least 1 card and no empty keys.
    const errors = [];
    if (!input.cardVersionKeys || input.cardVersionKeys.length === 0) {
      errors.push({ code: "DECK_EMPTY", message: "Deck must include at least one card." });
    }
    const hasEmpty = (input.cardVersionKeys || []).some((k) => !k || !k.trim());
    if (hasEmpty) {
      errors.push({ code: "DECK_INVALID_KEY", message: "Deck includes an empty card version key." });
    }
    return errors.length
      ? { ok: false, errors, warnings: [], extra: { validatedBy: "mock" } }
      : { ok: true, warnings: [], extra: { validatedBy: "mock" } };
  }

  async createMatch(input: CreateMatchInputV1): Promise<MatchInitV1> {
    // Store the minimal state we need; purely JSON.
    return {
      ok: true,
      state: {
        createdAt: nowIso(),
        matchId: input.matchId,
        seed: input.seed,
        participants: canonicalParticipantIds(input.participants),
        inputsHashHint: djb2(stableStringify(input.inputs)),
      },
      extra: { createdBy: "mock" },
    };
  }

  async runMatch(input: RunMatchInputV1): Promise<RunMatchResultV1> {
    const ids = canonicalParticipantIds(
      (input.inputs?.participants as any)?.map?.((p: any) => ({ participantId: p.participantId })) ??
        // fallback: if inputs doesn't carry participants, use state if shaped like createMatch state
        ((input.state as any)?.participants || []).map((participantId: string) => ({ participantId }))
    );

    const winner = pickWinnerDeterministically(input.seed, ids);

    return {
      ok: true,
      outputs: {
        winnerParticipantId: winner ?? null,
        // A tiny deterministic score: winner gets 1, others 0.
        scoresByParticipantId: ids.reduce((acc: Record<string, number>, pid) => {
          acc[pid] = pid === winner ? 1 : 0;
          return acc;
        }, {}),
        outcomeFlags: [],
      },
      extra: { ranBy: "mock" },
    };
  }

  async produceArtifact(input: ProduceArtifactInputV1): Promise<MatchArtifactV1> {
    const startedAt = nowIso();
    const completedAt = nowIso();

    const participantIdsSorted = canonicalParticipantIds(input.participants);
    const winner = pickWinnerDeterministically(input.seed, participantIdsSorted);

    // inputsDigest binds sanitized inputs (platform will likely compute; mock does it here).
    const inputsStable = stableStringify(input.inputs);
    const inputsDigestValue = djb2(inputsStable);

    // deterministicHash binds seed + inputs + outputs (non-crypto).
    const bundle = stableStringify({
      seed: input.seed,
      participants: participantIdsSorted,
      inputsDigest: inputsDigestValue,
      // deterministic outcome summary (recomputable from MatchArtifactV1)
      result: {
        winnerParticipantId: input.outputs.winnerParticipantId,
        scoresByParticipantId: input.outputs.scoresByParticipantId,
        outcomeFlags: input.outputs.outcomeFlags,
      },
    });
    const deterministicHashValue = djb2(bundle);

    const scoresByParticipantId = participantIdsSorted.reduce((acc: Record<string, number>, pid) => {
      acc[pid] = pid === winner ? 1 : 0;
      return acc;
    }, {});

    const timeline = [
      {
        idx: 0,
        code: "MATCH_START",
        at: startedAt,
        metrics: {},
        extra: { note: "mock adapter start" } as JSONObject,
      },
      {
        idx: 1,
        code: "MATCH_END",
        at: completedAt,
        participantId: winner,
        metrics: { winnerScore: winner ? 1 : 0 },
        extra: { note: "mock adapter end" } as JSONObject,
      },
    ];

    return {
      header: {
        artifactVersion: MATCH_ARTIFACT_VERSION,
        universeCode: input.universeCode,
        engineCode: input.engineCode,
        engineVersion: input.engineVersion,
        modeCode: input.modeCode,
        matchId: input.matchId,
        startedAt,
        completedAt,
      },
      participants: input.participants.map((p) => ({
        participantId: p.participantId,
        role: "PLAYER",
        extra: p.extra,
      })),
      seed: input.seed,
      inputsDigest: {
        algo: "noncrypto-djb2:stable-json-sortedkeys:v1",
        value: inputsDigestValue,
      },
      timeline,
      result: {
        winnerParticipantId: winner,
        placements: winner
          ? [
              { participantId: winner, placement: 1 },
              ...participantIdsSorted
                .filter((pid) => pid !== winner)
                .map((pid) => ({ participantId: pid, placement: 2 })),
            ]
          : undefined,
        scoresByParticipantId,
        outcomeFlags: [],
        scoringSummary: { kind: "mock", scoresByParticipantId } as JSONObject,
      },
      deterministicHash: {
        algo: "noncrypto-djb2:bundle:v1",
        value: deterministicHashValue,
      },
      replay: {
        replayVersion: "mock-replay:v1",
        payload: {
          seed: input.seed,
          participants: participantIdsSorted,
          inputsDigest: inputsDigestValue,
          deterministicHash: deterministicHashValue,
        },
      },
      platformMeta: {
        producedBy: "InProcessMockEngineAdapterV1",
        note: "Stub artifact for Phase 9 spine proof only.",
      },
    };
  }
}
