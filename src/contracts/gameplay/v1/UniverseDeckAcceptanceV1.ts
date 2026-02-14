/**
 * UniverseDeckAcceptanceV1 — Deck tag acceptance validator for universe entry.
 *
 * Milestone F — Ticket F3
 *
 * Responsibilities:
 * - Enforce deckAcceptance.requiredDeckTags
 * - Enforce deckAcceptance.forbiddenDeckTags
 * - Return structured decision codes
 *
 * Non-responsibilities:
 * - No DB lookups
 * - No schema assumptions about where tags come from
 * - No engine calls
 */

import type { UniverseIntegrationV1 } from "./UniverseIntegrationV1";

export type DeckAcceptanceDecisionCodeV1 =
  | "OK"
  | "MISSING_REQUIRED_TAG"
  | "HAS_FORBIDDEN_TAG"
  | "NO_DECK_ACCEPTANCE_POLICY";

export interface DeckAcceptanceDecisionV1 {
  ok: boolean;
  code: DeckAcceptanceDecisionCodeV1;
  message: string;
  input: {
    universeCode: string;
    deckTags: string[];
  };
  details?: {
    missingRequiredTags?: string[];
    forbiddenTagsPresent?: string[];
    requiredDeckTags?: string[];
    forbiddenDeckTags?: string[];
  };
}

export interface DeckAcceptanceParamsV1 {
  integration?: UniverseIntegrationV1;
  universeCode: string;
  deckTags: string[];
}

function decision(
  ok: boolean,
  code: DeckAcceptanceDecisionCodeV1,
  message: string,
  params: DeckAcceptanceParamsV1,
  details?: DeckAcceptanceDecisionV1["details"]
): DeckAcceptanceDecisionV1 {
  return {
    ok,
    code,
    message,
    input: {
      universeCode: params.universeCode,
      deckTags: params.deckTags,
    },
    details,
  };
}

export function validateDeckAcceptanceForUniverseV1(
  params: DeckAcceptanceParamsV1
): DeckAcceptanceDecisionV1 {
  const { integration, universeCode } = params;
  const deckTags = Array.isArray(params.deckTags) ? params.deckTags : [];

  const policy = integration?.deckAcceptance;

  if (!policy) {
    return decision(
      true,
      "NO_DECK_ACCEPTANCE_POLICY",
      "No deck acceptance policy declared (treat as allowed)",
      params
    );
  }

  const required = (policy.requiredDeckTags ?? []).filter(Boolean);
  const forbidden = (policy.forbiddenDeckTags ?? []).filter(Boolean);

  const missingRequired = required.filter((t) => !deckTags.includes(t));
  if (missingRequired.length > 0) {
    return decision(
      false,
      "MISSING_REQUIRED_TAG",
      "Deck missing required tag(s) for universe",
      params,
      {
        missingRequiredTags: missingRequired,
        requiredDeckTags: required,
        forbiddenDeckTags: forbidden,
      }
    );
  }

  const forbiddenPresent = forbidden.filter((t) => deckTags.includes(t));
  if (forbiddenPresent.length > 0) {
    return decision(
      false,
      "HAS_FORBIDDEN_TAG",
      "Deck contains forbidden tag(s) for universe",
      params,
      {
        forbiddenTagsPresent: forbiddenPresent,
        requiredDeckTags: required,
        forbiddenDeckTags: forbidden,
      }
    );
  }

  return decision(true, "OK", "Deck accepted for universe", params, {
    requiredDeckTags: required,
    forbiddenDeckTags: forbidden,
  });
}

export default validateDeckAcceptanceForUniverseV1;
