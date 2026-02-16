/**
 * UniverseEngineAuthorizationV1 — Validator for engine+mode authorization within a universe.
 *
 * Milestone F — Ticket F2
 *
 * Responsibilities:
 * - Given a UniverseIntegrationV1, engineCode/version, modeCode
 * - Validate that the engine is authorized for that universe
 * - Validate that the modeCode is allowed (universe-level and engine-level constraints)
 * - Return a structured decision (ok + reason codes)
 *
 * Non-responsibilities:
 * - No DB
 * - No gameplay execution
 * - No eligibility checks
 */

import type { UniverseIntegrationV1 } from "./UniverseIntegrationV1";

export type UniverseAuthorizationDecisionCodeV1 =
  | "OK"
  | "UNIVERSE_NOT_FOUND"
  | "ENGINE_NOT_AUTHORIZED"
  | "ENGINE_VERSION_NOT_AUTHORIZED"
  | "MODE_NOT_ALLOWED_BY_UNIVERSE"
  | "MODE_NOT_ALLOWED_BY_ENGINE";

export interface UniverseAuthorizationDecisionV1 {
  ok: boolean;
  code: UniverseAuthorizationDecisionCodeV1;
  message: string;

  /** Echoed inputs for debugging/logging. */
  input: {
    universeCode: string;
    engineCode: string;
    engineVersion: string;
    modeCode: string;
  };

  /** Optional details for operators / logs. */
  details?: {
    allowedModeCodesAtUniverse?: string[];
    allowedModeCodesAtEngine?: string[];
    authorizedEngines?: Array<{ engineCode: string; engineVersion: string }>;
  };
}

export interface UniverseEngineAuthorizationParamsV1 {
  integration?: UniverseIntegrationV1;
  universeCode: string;
  engineCode: string;
  engineVersion: string;
  modeCode: string;
}

function decision(
  ok: boolean,
  code: UniverseAuthorizationDecisionCodeV1,
  message: string,
  params: UniverseEngineAuthorizationParamsV1,
  details?: UniverseAuthorizationDecisionV1["details"]
): UniverseAuthorizationDecisionV1 {
  return {
    ok,
    code,
    message,
    input: {
      universeCode: params.universeCode,
      engineCode: params.engineCode,
      engineVersion: params.engineVersion,
      modeCode: params.modeCode,
    },
    details,
  };
}

export function authorizeEngineForUniverseV1(
  params: UniverseEngineAuthorizationParamsV1
): UniverseAuthorizationDecisionV1 {
  const { integration, universeCode, engineCode, engineVersion, modeCode } = params;

  if (!integration) {
    return decision(false, "UNIVERSE_NOT_FOUND", "Universe integration not found", params);
  }

  const authorizedEngines = integration.authorizedEngines ?? [];
  const engineMatches = authorizedEngines.filter((e) => e.engineCode === engineCode);

  if (engineMatches.length === 0) {
    return decision(false, "ENGINE_NOT_AUTHORIZED", "Engine code not authorized for universe", params, {
      authorizedEngines: authorizedEngines.map((e) => ({ engineCode: e.engineCode, engineVersion: e.engineVersion })),
      allowedModeCodesAtUniverse: integration.allowedModeCodes,
    });
  }

  const versionMatches = engineMatches.filter((e) => e.engineVersion === engineVersion);
  if (versionMatches.length === 0) {
    return decision(
      false,
      "ENGINE_VERSION_NOT_AUTHORIZED",
      "Engine version not authorized for universe",
      params,
      {
        authorizedEngines: engineMatches.map((e) => ({ engineCode: e.engineCode, engineVersion: e.engineVersion })),
        allowedModeCodesAtUniverse: integration.allowedModeCodes,
      }
    );
  }

  // Universe-level mode gate (optional)
  if (Array.isArray(integration.allowedModeCodes) && integration.allowedModeCodes.length > 0) {
    if (!integration.allowedModeCodes.includes(modeCode)) {
      return decision(
        false,
        "MODE_NOT_ALLOWED_BY_UNIVERSE",
        "Mode code not allowed by universe",
        params,
        {
          allowedModeCodesAtUniverse: integration.allowedModeCodes,
          authorizedEngines: versionMatches.map((e) => ({ engineCode: e.engineCode, engineVersion: e.engineVersion })),
        }
      );
    }
  }

  // Engine-level mode gate (optional, per authorized engine)
  const engineLevelAllowed = versionMatches
    .map((e) => e.modeCodes)
    .find((m) => Array.isArray(m) && m.length > 0) as string[] | undefined;

  if (Array.isArray(engineLevelAllowed) && engineLevelAllowed.length > 0) {
    if (!engineLevelAllowed.includes(modeCode)) {
      return decision(
        false,
        "MODE_NOT_ALLOWED_BY_ENGINE",
        "Mode code not allowed by authorized engine binding",
        params,
        {
          allowedModeCodesAtEngine: engineLevelAllowed,
          allowedModeCodesAtUniverse: integration.allowedModeCodes,
        }
      );
    }
  }

  return decision(true, "OK", "Authorized", params, {
    allowedModeCodesAtUniverse: integration.allowedModeCodes,
    allowedModeCodesAtEngine: engineLevelAllowed,
    authorizedEngines: versionMatches.map((e) => ({ engineCode: e.engineCode, engineVersion: e.engineVersion })),
  });
}

export default authorizeEngineForUniverseV1;
