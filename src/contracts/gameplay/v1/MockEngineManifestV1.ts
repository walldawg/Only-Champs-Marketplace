/**
 * MockEngineManifestV1 — Reference manifest for the Phase 9 spine-proof mock engine.
 *
 * Location: src/contracts/gameplay/v1/
 *
 * Notes:
 * - This is a static descriptor only (no loading/registry wiring here).
 * - Values mirror what a real engine would publish.
 */

import type { EngineManifestV1 } from "./EngineManifestV1";

export const MockEngineManifestV1: EngineManifestV1 = {
  "manifestVersion": "EngineManifestV1",
  "engineCode": "MOCK_ENGINE",
  "engineVersion": "0.0.1",
  "name": "Mock Engine (Spine Proof)",
  "description": "Deterministic stub engine used to prove Phase 9 contract spine end-to-end. Not real gameplay.",
  "supportedUniverseCodes": [
    "UNIV_TEST"
  ],
  "modes": [
    {
      "modeCode": "ROOKIE",
      "name": "Rookie (Mock)",
      "description": "Deterministic winner selection from seed + participants. For contract proof only.",
      "extra": {
        "purpose": "phase9_spine_proof"
      }
    }
  ],
  "requiredInputs": {
    "expects": [
      "participants",
      "seed",
      "inputs"
    ],
    "notes": "Inputs are treated as opaque JSON. This mock expects inputs.participants to be present for runMatch convenience, but produceArtifact only requires participants passed separately."
  },
  "artifactVersion": "MatchArtifactV1",
  "determinism": {
    "level": "FULL",
    "rngStrategy": "seeded-noncrypto-djb2-index",
    "notes": "Winner is chosen deterministically by hashing seed + sorted participant ids (non-cryptographic)."
  },
  "sandbox": {
    "timeoutMs": 250,
    "maxReplayBytes": 16384,
    "maxTimelineEvents": 64
  },
  "extra": {
    "warning": "Not suitable for competitive play. For internal conformance testing only.",
    "adapterClass": "InProcessMockEngineAdapterV1"
  }
} as const;

export default MockEngineManifestV1;
