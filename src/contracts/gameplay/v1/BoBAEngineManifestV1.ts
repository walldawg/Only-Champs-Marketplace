/**
 * BoBAEngineManifestV1 — Bo Jackson Battle Arena engine binding (manifest only).
 *
 * Phase 15 Step 1 (binding, no gameplay changes):
 * - Declares how BoBA will identify itself to the platform spine
 * - No Prisma types
 * - No adapter implementation here
 *
 * Next steps (not in this file):
 * - Implement BoBAEngineAdapterV1 that conforms to EngineAdapterV1
 * - Add a BoltOnKitV1 descriptor for BoBA engine conformance runs
 */

import type { EngineManifestV1 } from "./EngineManifestV1";
import type { JSONObject } from "./MatchArtifactV1";

export const BOBA_ENGINE_CODE = "BOBA_CORE" as const;
export const BOBA_ENGINE_VERSION = "0.1.0" as const;

/**
 * BoBA engine manifest.
 *
 * Notes:
 * - universeCodes: where this engine is permitted to run
 * - modeCodes: platform mode codes that map to BoBA modes (ROOKIE etc.)
 * - capabilities: optional flags for humans and future registries
 */
export const BoBAEngineManifestV1: EngineManifestV1 = {
  manifestVersion: "EngineManifestV1",
  engineCode: BOBA_ENGINE_CODE,
  engineVersion: BOBA_ENGINE_VERSION,

  displayName: "BoBA Core Engine",
  description: "Bo Jackson Battle Arena gameplay engine (Phase 15 binding stub).",

  universeCodes: ["BOBA"],

  supportedModes: [
    {
      modeCode: "ROOKIE",
      description: "Rookie mode (platform spine binding; gameplay rules owned by BoBA engine).",
    },
    {
      modeCode: "SCORED",
      description: "Scored mode (platform spine binding; gameplay rules owned by BoBA engine).",
    },
  ],

  capabilities: {
    deterministicArtifacts: true,
    producesReplayPayload: true,
    supportsTournaments: true,
    supportsEligibilityPackets: true,
    supportsRewardIntents: true,
    supportsAuditVerification: true,
  } as unknown as JSONObject,

  extra: {
    note: "Phase 15 Step 1: manifest only. Adapter comes next.",
  } as unknown as JSONObject,
};

export default BoBAEngineManifestV1;
