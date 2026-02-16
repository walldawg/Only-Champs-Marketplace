/**
 * EngineRegistryV1 — Platform-owned Universe → Engine binding shapes.
 *
 * Phase 9 Implementation Step 4:
 * - Shape only (types + interfaces)
 * - No DB schema, no Prisma, no storage assumptions
 *
 * Choice: MULTI-engine per universe is supported (Option B), but platform policy may
 * select exactly one "active/default" binding for match creation in Phase 9.
 */

import type { IdString, JSONObject } from "./MatchArtifactV1";

export const ENGINE_REGISTRY_VERSION = "EngineRegistryV1" as const;

/**
 * Binding status allows staged installs without deleting records.
 * Phase 9 can treat only ACTIVE bindings as eligible for match creation.
 */
export type EngineBindingStatusV1 = "ACTIVE" | "DISABLED" | "DEPRECATED";

/**
 * A single Universe → Engine binding record.
 *
 * Notes:
 * - engineVersion is locked at bind time for stability.
 * - defaultModeCode is optional; platform may require caller to specify a mode.
 * - precedence can be used when multiple ACTIVE bindings exist (future-ready).
 */
export interface EngineBindingV1 {
  bindingId: IdString;

  universeCode: string;

  engineCode: string;
  engineVersion: string;

  /** Optional default mode for match creation if caller doesn't specify. */
  defaultModeCode?: string;

  /** Binding lifecycle status. */
  status: EngineBindingStatusV1;

  /**
   * Optional precedence ordering. Lower number = higher priority.
   * If omitted, platform may treat precedence as equal.
   */
  precedence?: number;

  /** ISO-8601 timestamp when created (platform time). */
  createdAt: string;

  /** ISO-8601 timestamp when last updated (platform time). */
  updatedAt: string;

  /** Optional human/admin notes (JSON-safe). */
  meta?: JSONObject;
}

/**
 * Registry view for a single Universe.
 * Supports multiple bindings (Option B).
 */
export interface UniverseEngineBindingsV1 {
  registryVersion: typeof ENGINE_REGISTRY_VERSION;
  universeCode: string;

  bindings: EngineBindingV1[];
}

/**
 * Minimal lookup contract the platform can rely on.
 * No storage details are implied.
 */
export interface EngineRegistryLookupV1 {
  /**
   * List all bindings for a universe (including non-active if desired by caller).
   */
  listBindingsByUniverse(universeCode: string): Promise<UniverseEngineBindingsV1>;

  /**
   * Resolve the binding the platform should use for match creation.
   *
   * Phase 9 policy suggestion:
   * - Choose ACTIVE binding with lowest precedence (if multiple)
   * - If none ACTIVE, fail
   */
  resolveDefaultBinding(universeCode: string): Promise<EngineBindingV1 | null>;

  /**
   * Resolve a specific binding by id.
   */
  getBindingById(bindingId: IdString): Promise<EngineBindingV1 | null>;
}
