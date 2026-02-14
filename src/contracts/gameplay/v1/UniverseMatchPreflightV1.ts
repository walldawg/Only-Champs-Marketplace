/**
 * UniverseMatchPreflightV1 — Universe-aware preflight gate for match/session entry.
 *
 * Milestone F — Ticket F4
 *
 * Purpose:
 * - Provide a single preflight decision that prevents cross-universe leakage
 * - Compose:
 *    (F1) UniverseIntegrationRegistryV1
 *    (F2) UniverseEngineAuthorizationV1
 *    (F3) UniverseDeckAcceptanceV1
 *
 * Output:
 * - Structured decision with:
 *    - ok boolean
 *    - violationCode (operator-aligned)
 *    - message
 *    - evidence payload (inputs + any details from sub-validators)
 *
 * Non-responsibilities:
 * - No DB lookups
 * - No engine execution
 * - No eligibility engine calls
 */

import type { UniverseIntegrationRegistryV1 } from "./UniverseIntegrationRegistryV1";
import { authorizeEngineForUniverseV1, type UniverseAuthorizationDecisionV1 } from "./UniverseEngineAuthorizationV1";
import { validateDeckAcceptanceForUniverseV1, type DeckAcceptanceDecisionV1 } from "./UniverseDeckAcceptanceV1";

export type OperatorViolationCodeV1 =
  | "OK"
  | "V_UNIVERSE_NOT_FOUND"
  | "V_ENGINE_NOT_AUTHORIZED"
  | "V_ENGINE_VERSION_NOT_AUTHORIZED"
  | "V_MODE_NOT_ALLOWED"
  | "V_DECK_MISSING_REQUIRED_TAG"
  | "V_DECK_HAS_FORBIDDEN_TAG";

export interface UniverseMatchPreflightEvidenceV1 {
  universeCode: string;
  engineCode: string;
  engineVersion: string;
  modeCode: string;
  deckTags: string[];

  authorization?: UniverseAuthorizationDecisionV1;
  deckAcceptance?: DeckAcceptanceDecisionV1;
}

export interface UniverseMatchPreflightDecisionV1 {
  ok: boolean;
  violationCode: OperatorViolationCodeV1;
  message: string;
  evidence: UniverseMatchPreflightEvidenceV1;
}

export interface UniverseMatchPreflightParamsV1 {
  registry: UniverseIntegrationRegistryV1;

  universeCode: string;
  engineCode: string;
  engineVersion: string;
  modeCode: string;

  /** Provided by caller (platform) — preflight does not fetch from DB. */
  deckTags: string[];
}

function decision(
  ok: boolean,
  violationCode: OperatorViolationCodeV1,
  message: string,
  evidence: UniverseMatchPreflightEvidenceV1
): UniverseMatchPreflightDecisionV1 {
  return { ok, violationCode, message, evidence };
}

export function runUniverseMatchPreflightV1(
  params: UniverseMatchPreflightParamsV1
): UniverseMatchPreflightDecisionV1 {
  const integration = params.registry.get(params.universeCode);

  const evidence: UniverseMatchPreflightEvidenceV1 = {
    universeCode: params.universeCode,
    engineCode: params.engineCode,
    engineVersion: params.engineVersion,
    modeCode: params.modeCode,
    deckTags: Array.isArray(params.deckTags) ? params.deckTags : [],
  };

  // Step 1: Universe exists
  if (!integration) {
    return decision(false, "V_UNIVERSE_NOT_FOUND", "Universe integration not found", evidence);
  }

  // Step 2: Engine + mode authorization
  const auth = authorizeEngineForUniverseV1({
    integration,
    universeCode: params.universeCode,
    engineCode: params.engineCode,
    engineVersion: params.engineVersion,
    modeCode: params.modeCode,
  });
  evidence.authorization = auth;

  if (!auth.ok) {
    switch (auth.code) {
      case "UNIVERSE_NOT_FOUND":
        return decision(false, "V_UNIVERSE_NOT_FOUND", auth.message, evidence);
      case "ENGINE_NOT_AUTHORIZED":
        return decision(false, "V_ENGINE_NOT_AUTHORIZED", auth.message, evidence);
      case "ENGINE_VERSION_NOT_AUTHORIZED":
        return decision(false, "V_ENGINE_VERSION_NOT_AUTHORIZED", auth.message, evidence);
      case "MODE_NOT_ALLOWED_BY_UNIVERSE":
      case "MODE_NOT_ALLOWED_BY_ENGINE":
        return decision(false, "V_MODE_NOT_ALLOWED", auth.message, evidence);
      default:
        return decision(false, "V_ENGINE_NOT_AUTHORIZED", auth.message, evidence);
    }
  }

  // Step 3: Deck acceptance gate (tags)
  const da = validateDeckAcceptanceForUniverseV1({
    integration,
    universeCode: params.universeCode,
    deckTags: evidence.deckTags,
  });
  evidence.deckAcceptance = da;

  if (!da.ok) {
    switch (da.code) {
      case "MISSING_REQUIRED_TAG":
        return decision(false, "V_DECK_MISSING_REQUIRED_TAG", da.message, evidence);
      case "HAS_FORBIDDEN_TAG":
        return decision(false, "V_DECK_HAS_FORBIDDEN_TAG", da.message, evidence);
      default:
        return decision(false, "V_DECK_MISSING_REQUIRED_TAG", da.message, evidence);
    }
  }

  return decision(true, "OK", "Preflight OK", evidence);
}

export default runUniverseMatchPreflightV1;
