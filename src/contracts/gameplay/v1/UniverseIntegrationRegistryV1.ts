/**
 * UniverseIntegrationRegistryV1 — Loader + in-memory registry for UniverseIntegrationV1.
 *
 * Milestone F — Ticket F1
 *
 * Responsibilities:
 * - Accept a list of UniverseIntegrationV1 records
 * - Validate structural invariants
 * - Index by universeCode
 * - Provide deterministic lookup
 *
 * Non-responsibilities:
 * - No DB
 * - No enforcement of gameplay
 * - No engine execution
 */

import type { UniverseIntegrationV1 } from "./UniverseIntegrationV1";

export interface UniverseIntegrationRegistryV1 {
  get(universeCode: string): UniverseIntegrationV1 | undefined;
  list(): UniverseIntegrationV1[];
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`[UniverseIntegrationRegistryV1] ${message}`);
  }
}

export function createUniverseIntegrationRegistryV1(
  integrations: UniverseIntegrationV1[]
): UniverseIntegrationRegistryV1 {
  const map = new Map<string, UniverseIntegrationV1>();

  for (const integration of integrations) {
    assert(
      integration.integrationVersion === "UniverseIntegrationV1",
      `Invalid integrationVersion for ${integration.integrationId}`
    );

    const universeCode = integration.universe?.universeCode;
    assert(!!universeCode, `Missing universeCode for ${integration.integrationId}`);

    assert(
      !map.has(universeCode),
      `Duplicate universeCode detected: ${universeCode}`
    );

    assert(
      Array.isArray(integration.authorizedEngines) &&
        integration.authorizedEngines.length > 0,
      `authorizedEngines must be non-empty for ${universeCode}`
    );

    assert(
      !!integration.eligibilityPolicy?.policyId,
      `eligibilityPolicy.policyId required for ${universeCode}`
    );

    assert(
      !!integration.interpretationPolicy?.policyId,
      `interpretationPolicy.policyId required for ${universeCode}`
    );

    map.set(universeCode, integration);
  }

  return {
    get(universeCode: string) {
      return map.get(universeCode);
    },
    list() {
      return Array.from(map.values());
    },
  };
}

export default createUniverseIntegrationRegistryV1;
