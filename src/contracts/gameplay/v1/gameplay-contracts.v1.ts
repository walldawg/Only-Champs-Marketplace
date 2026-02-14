/**
 * gameplay-contracts.v1.ts — Single export surface for Phase 9 contract spine.
 *
 * Phase 9 Implementation Step 9:
 * - One file that re-exports all Phase 9 contract types/constants.
 * - No runtime logic.
 *
 * Purpose:
 * - Platform and engines import from ONE stable module path.
 * - Prevents ad-hoc deep imports that cause drift.
 */

export * from "./MatchArtifactV1";
export * from "./EngineAdapterV1";
export * from "./EngineManifestV1";
export * from "./EngineRegistryV1";
export * from "./DeterminismV1";
export * from "./MatchOrchestrationPacketV1";
export * from "./EngineConformanceKitV1";
export * from "./PlatformGameplayEventsV1";
