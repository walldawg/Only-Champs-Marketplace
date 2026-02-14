/**
 * EngineConformanceKitV1 — Type-only spec for adapter conformance tests.
 *
 * Phase 9 Implementation Step 7:
 * - Define test vector shapes the platform can run against any engine.
 * - No runner implementation, no assertions framework, no IO.
 *
 * Purpose:
 * - Enable "bolt-on kit" later (Phase 14) without redesign.
 * - Make determinism + contract adherence testable from JSON packets.
 */

import type { JSONObject, IdString, MatchArtifactV1 } from "./MatchArtifactV1";
import type {
  ValidateDeckInputV1,
  DeckValidationResultV1,
  CreateMatchInputV1,
  MatchInitV1,
  RunMatchInputV1,
  RunMatchResultV1,
  ProduceArtifactInputV1,
  EngineErrorV1,
} from "./EngineAdapterV1";
import type { DeterminismHashBundleV1 } from "./DeterminismV1";

export const ENGINE_CONFORMANCE_KIT_VERSION = "EngineConformanceKitV1" as const;

/** A single deterministic test vector for an engine+mode. */
export interface EngineConformanceTestCaseV1 {
  /** Unique test case id. */
  testId: string;

  universeCode: string;
  engineCode: string;
  engineVersion: string;
  modeCode: string;

  /** Platform-minted match id for the test run. */
  matchId: IdString;

  /** Seed used for deterministic binding. */
  seed: string;

  /** Participants in canonical order. */
  participants: Array<{ participantId: IdString; extra?: JSONObject }>;

  /** Sanitized inputs packet. */
  inputs: JSONObject;

  /** Optional deck validation packet. */
  validateDeck?: ValidateDeckInputV1;

  /**
   * Expected outcomes (optional; conformance can run in "record" mode first).
   * If provided, the platform should assert equality on these fields.
   */
  expect?: {
    /** validateDeck expectation. */
    deckValidation?: Partial<DeckValidationResultV1>;

    /** createMatch expectation (e.g., ok=true). */
    matchInit?: Partial<MatchInitV1>;

    /** runMatch expectation (e.g., ok=true; outcome flags). */
    runMatch?: Partial<RunMatchResultV1>;

    /**
     * Produced artifact expectations.
     * - At minimum, platform should validate required fields and header routing.
     * - For determinism, compare deterministicHash.value.
     */
    artifact?: {
      /** Expected deterministic hash algorithm label (optional). */
      deterministicHashAlgo?: string;

      /** Expected deterministic hash value (optional). */
      deterministicHashValue?: string;

      /** Expected inputs digest algo/value (optional). */
      inputsDigestAlgo?: string;
      inputsDigestValue?: string;

      /** Optional expected winner/placements/scores subset. */
      resultSubset?: JSONObject;
    };

    /**
     * Expected determinism bundle (optional).
     * Platform may compare the canonical serialization output hash instead of bundle equality.
     */
    determinismBundle?: Partial<DeterminismHashBundleV1>;
  };

  /** Optional notes for humans. */
  notes?: string;
}

/** A suite of conformance test cases for an engine version. */
export interface EngineConformanceSuiteV1 {
  kitVersion: typeof ENGINE_CONFORMANCE_KIT_VERSION;

  engineCode: string;
  engineVersion: string;

  /** ISO-8601 created timestamp for the suite. */
  createdAt: string;

  testCases: EngineConformanceTestCaseV1[];

  /** Optional suite metadata (JSON). */
  meta?: JSONObject;
}

/** Result of running a single conformance test case. */
export interface EngineConformanceTestResultV1 {
  testId: string;

  ok: boolean;

  /** Any assertion failures captured as errors. */
  errors?: EngineErrorV1[];

  /**
   * Captured outputs for audit/debug.
   * Platform may omit large fields depending on policy.
   */
  outputs?: {
    deckValidation?: DeckValidationResultV1;
    matchInit?: MatchInitV1;
    runMatch?: RunMatchResultV1;
    produceArtifactInput?: ProduceArtifactInputV1;
    artifact?: MatchArtifactV1;
    determinismBundle?: DeterminismHashBundleV1;
  };
}

/** Result of running an entire suite. */
export interface EngineConformanceSuiteResultV1 {
  kitVersion: typeof ENGINE_CONFORMANCE_KIT_VERSION;

  engineCode: string;
  engineVersion: string;

  /** ISO-8601 run timestamp. */
  ranAt: string;

  ok: boolean;

  results: EngineConformanceTestResultV1[];

  /** Optional summary stats for quick reporting. */
  summary?: {
    total: number;
    passed: number;
    failed: number;
  };
}
