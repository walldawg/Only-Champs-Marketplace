/**
 * EngineManifestV1 — Bolt-on descriptor for installed engines.
 *
 * Purpose:
 * - Platform can list installed engines + modes from manifests alone.
 * - Pure JSON (no Prisma/DB types).
 * - Declares capabilities and rules of engagement.
 *
 * Phase 9 Implementation Step 3:
 * - Types + shape only (no registry binding, no loading logic).
 */

import type { JSONObject } from "./MatchArtifactV1";

export const ENGINE_MANIFEST_VERSION = "EngineManifestV1" as const;

export interface EngineModeManifestV1 {
  /** Mode code inside the engine (e.g., "ROOKIE"). */
  modeCode: string;

  /** Human description for UI/catalog browsing. */
  name: string;

  /** Optional longer description. */
  description?: string;

  /**
   * Optional constraints or assumptions for this mode (engine-defined).
   * Must be JSON.
   */
  extra?: JSONObject;
}

export interface EngineDeterminismDeclarationV1 {
  /**
   * Declarative statement of determinism expectations.
   * Examples:
   * - "FULL" (same inputs+seed => same outputs)
   * - "PARTIAL" (deterministic winner/score but replay may vary)
   * - "NONE" (not allowed for competitive tournaments)
   *
   * Platform policy may later gate tournaments on this.
   */
  level: "FULL" | "PARTIAL" | "NONE";

  /**
   * If RNG is used, declare the RNG strategy name (engine-defined).
   * Example: "seeded-xorshift128+"
   */
  rngStrategy?: string;

  /**
   * Optional freeform notes for audit/debug (not used for trust decisions).
   */
  notes?: string;
}

export interface EngineManifestV1 {
  /** Must equal "EngineManifestV1". */
  manifestVersion: typeof ENGINE_MANIFEST_VERSION;

  /** Engine identity (e.g., "BOBA_CORE"). */
  engineCode: string;

  /** Engine version (semver-like string). */
  engineVersion: string;

  /** Human name for UI/admin. */
  name: string;

  /** Optional description. */
  description?: string;

  /**
   * Universes this engine can attach to (e.g., ["BOBA"]).
   * A universe may also choose to be collectible-only with no engine binding.
   */
  supportedUniverseCodes: string[];

  /** Declared playable modes. */
  modes: EngineModeManifestV1[];

  /**
   * What inputs the engine expects in createMatch/runMatch packets.
   * This is descriptive; the actual contract remains JSON.
   *
   * Example:
   * { "expects": ["participants", "decks", "seed"], "schemaHint": {...} }
   */
  requiredInputs?: JSONObject;

  /**
   * Artifact version emitted by the engine for Phase 9 (must be MatchArtifactV1).
   * Kept as string to avoid import coupling; platform can validate against constant.
   */
  artifactVersion: "MatchArtifactV1";

  /** Determinism declaration to support tournament trust. */
  determinism: EngineDeterminismDeclarationV1;

  /**
   * Optional sandbox requirements if run out-of-process later.
   * Platform may enforce these as limits.
   */
  sandbox?: {
    /** Max milliseconds an individual match is expected to run within. */
    timeoutMs?: number;

    /** Max bytes for replay payload (platform-enforced cap may override). */
    maxReplayBytes?: number;

    /** Max number of timeline events (platform-enforced cap may override). */
    maxTimelineEvents?: number;
  };

  /**
   * Engine-defined metadata, safe JSON only.
   * Useful for feature flags, build hashes, repo commit, etc.
   */
  extra?: JSONObject;
}
