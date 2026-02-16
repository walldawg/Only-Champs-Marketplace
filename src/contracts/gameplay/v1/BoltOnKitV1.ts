/**
 * BoltOnKitV1 — Packaging contract for external engines to plug into the platform.
 *
 * Phase 14 Step 1 (types only):
 * - Defines the minimal "kit" metadata an external engine ships alongside its adapter
 * - Points to conformance tests and required exports
 * - Engine-agnostic, platform-owned contract
 * - No Prisma types, no build tooling assumptions
 *
 * Key idea:
 * - A bolt-on engine provides:
 *   (1) Engine manifest (EngineManifestV1)
 *   (2) Engine adapter implementation (EngineAdapterV1)
 *   (3) Conformance entrypoint (runs EngineConformanceKitV1)
 * - Platform can run the conformance entrypoint to validate compatibility.
 */

import type { IdString, JSONObject } from "./MatchArtifactV1";

export const BOLT_ON_KIT_VERSION = "BoltOnKitV1" as const;

export type BoltOnRuntimeV1 = "node" | "bun" | "deno" | "custom";

export type BoltOnConformanceStatusV1 = "PASS" | "FAIL" | "SKIPPED" | "ERROR";

export interface BoltOnConformanceResultV1 {
  status: BoltOnConformanceStatusV1;
  ranAt: string;
  summary?: string;
  details?: JSONObject;
}

/**
 * Declares how the platform should run the engine's conformance entrypoint.
 * This is metadata only — execution lives outside this contract.
 */
export interface BoltOnConformanceEntrypointV1 {
  runtime: BoltOnRuntimeV1;

  /**
   * Example:
   *  - node: ["node", "dist/conformance.js"]
   *  - node (tsx): ["npx","-y","tsx","src/conformance.ts"]
   */
  command: string[];

  /** Optional working directory relative to kit root. */
  cwd?: string;

  /** Optional environment variables required for the conformance run. */
  env?: Record<string, string>;

  /** Optional notes for humans. */
  notes?: string;
}

/**
 * Minimal references for what the engine kit exports/provides.
 * The platform expects these symbols to exist and conform to Phase 9 contracts.
 */
export interface BoltOnExportsV1 {
  /** E.g. "./src/MyEngineAdapterV1.ts" or "./dist/adapter.js" */
  engineAdapterModule: string;

  /** Named export expected in engineAdapterModule. */
  engineAdapterExportName: string; // e.g. "MyEngineAdapterV1"

  /** Optional manifest module if not embedded/constructed at runtime. */
  engineManifestModule?: string;
  engineManifestExportName?: string; // e.g. "MyEngineManifestV1"
}

/**
 * One kit = one engine implementation (one engineCode).
 * Versions allow multiple kits over time.
 */
export interface BoltOnKitV1 {
  kitVersion: typeof BOLT_ON_KIT_VERSION;

  kitId: IdString;

  /** Human-readable name. */
  name: string;

  /** Optional description. */
  description?: string;

  /** Engine identity binding. */
  engine: {
    engineCode: string;
    engineVersion: string;
    universeCodes?: string[]; // if the engine is universe-scoped
    modeCodes?: string[]; // if the engine only supports certain modes
  };

  /** Kit ownership / provenance (optional). */
  publisher?: {
    orgId?: IdString;
    name?: string;
    contact?: string;
    website?: string;
  };

  /** Export locations for adapter/manifest. */
  exports: BoltOnExportsV1;

  /** How to run conformance tests for this kit. */
  conformance: {
    entrypoint: BoltOnConformanceEntrypointV1;
    lastResult?: BoltOnConformanceResultV1;
  };

  /** Optional compatibility declarations. */
  compatibility?: {
    requiredContracts?: string[]; // e.g. ["MatchArtifactV1","EngineAdapterV1","PlatformGameplayEventsV1"]
    minPlatformVersion?: string;
  };

  /** Optional extra metadata. */
  extra?: JSONObject;
}
